import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  claimGeneration,
  findKeywordById,
  failGeneration,
  linkArticle,
  findOrgById,
  createArticle,
} = vi.hoisted(() => ({
  claimGeneration: vi.fn(async () => true),
  findKeywordById: vi.fn(),
  failGeneration: vi.fn(async () => {}),
  linkArticle: vi.fn(async () => {}),
  findOrgById: vi.fn(),
  createArticle: vi.fn(async (_doc: unknown) => ({ id: 'art1' })),
}));
vi.mock('@shared/db', () => ({
  KeywordRepo: { claimGeneration, findById: findKeywordById, failGeneration, linkArticle },
  OrgRepo: { findById: findOrgById },
  ArticleRepo: { create: createArticle },
}));

const { generateArticle } = vi.hoisted(() => ({ generateArticle: vi.fn() }));
vi.mock('@shared/generation', async (orig) => ({
  ...(await orig<typeof import('@shared/generation')>()),
  generateArticle,
}));

vi.mock('../src/providers', () => ({ getGenerationClients: () => ({ llm: {} }) }));

const { enqueueImageTask } = vi.hoisted(() => ({ enqueueImageTask: vi.fn(async () => {}) }));
vi.mock('../src/queue', () => ({ enqueueImageTask }));

import { handler } from '../src/generation';

function event(body: unknown): SQSEvent {
  return {
    Records: [
      {
        messageId: '1',
        receiptHandle: 'rh',
        body: JSON.stringify(body),
        attributes: {} as never,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

const org = {
  id: 'o1',
  plan: 'paid',
  website_url: 'https://x.com',
  presets: {
    business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
    audience: { target: 'makers', competitors: [] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: { article_style: 'x', internal_links: false, llm_instructions: '' },
      engagement: { image_style: '' },
    },
  },
};
const keyword = {
  id: 'k1',
  org_id: 'o1',
  keyword: 'best widgets',
  difficulty: 10,
  search_volume: 100,
};

const okArticle = {
  ok: true,
  article: {
    title: 'Best Widgets For Makers',
    meta_title: 'm',
    meta_description: 'd',
    slug: 's',
    content: '# body',
    usage: { totalTokens: 1, costUsd: 0.01 },
  },
};

describe('generation worker', () => {
  beforeEach(() => vi.clearAllMocks());

  test('claims, generates, persists article, links keyword', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(claimGeneration).toHaveBeenCalledWith('k1');
    expect(createArticle).toHaveBeenCalledTimes(1);
    expect(createArticle.mock.calls[0]![0]).toMatchObject({
      status: 'generated',
      featured_image_url: '',
    });
    expect(linkArticle).toHaveBeenCalledWith('k1', 'art1');
    expect(enqueueImageTask).toHaveBeenCalledWith({ org_id: 'o1', article_id: 'art1' });
  });

  test('image task enqueue failure does not fail generation', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    enqueueImageTask.mockRejectedValueOnce(new Error('sqs down'));

    await expect(
      handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {}),
    ).resolves.toBeUndefined();

    expect(linkArticle).toHaveBeenCalledWith('k1', 'art1');
    expect(failGeneration).not.toHaveBeenCalled();
  });

  test('skips when claim fails (already done/in-flight)', async () => {
    // Once, not permanently: vi.clearAllMocks() clears calls but NOT implementations,
    // so a plain mockResolvedValue(false) would leak into the later tests.
    claimGeneration.mockResolvedValueOnce(false);
    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});
    expect(findOrgById).not.toHaveBeenCalled();
    expect(createArticle).not.toHaveBeenCalled();
  });

  test('validation failure records failGeneration and does not create an article', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue({
      ok: false,
      failures: [{ code: 'word_count', message: 'x' }],
    });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(createArticle).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith('k1', expect.stringContaining('validation'));
  });

  test('non-paid org is skipped and recorded', async () => {
    findOrgById.mockResolvedValue({ ...org, plan: 'free' });
    findKeywordById.mockResolvedValue(keyword);
    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});
    expect(generateArticle).not.toHaveBeenCalled();
    expect(failGeneration).toHaveBeenCalledWith('k1', expect.stringContaining('not paid'));
  });

  test('provider error records failGeneration and rethrows', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockRejectedValue(new Error('rate limited'));

    await expect(
      handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {}),
    ).rejects.toThrow('rate limited');
    expect(failGeneration).toHaveBeenCalledWith('k1', 'rate limited');
  });
});
