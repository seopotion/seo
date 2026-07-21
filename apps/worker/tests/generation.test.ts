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

const { llmComplete, searchVideos } = vi.hoisted(() => ({
  llmComplete: vi.fn(),
  searchVideos: vi.fn(async () => [] as unknown[]),
}));
vi.mock('../src/providers', () => ({
  getGenerationClients: () => ({ llm: { complete: llmComplete }, youtube: { searchVideos } }),
}));

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
    audience: { target: ['makers'], competitors: [] },
    blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
    article_preferences: {
      content_seo: {
        article_style: 'x',
        internal_links_count: 0,
        table_of_contents: true,
        llm_instructions: '',
      },
      engagement: { image_style: '', youtube_videos: true },
      publishing: { auto_publish: false },
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

const okArticleWithSection = {
  ok: true,
  article: {
    ...okArticle.article,
    content: '# body\n\n## Section One\n\ntext',
  },
};

const candidate = { video_id: 'v1', title: 'Widget basics', description: 'd', channel: 'c' };
const pickJson = (text: string) => ({
  text,
  model: 'm',
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
});

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

  test('embeds a picked YouTube video: iframe in content + structured video field', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticleWithSection);
    searchVideos.mockResolvedValueOnce([candidate]);
    llmComplete.mockResolvedValueOnce(
      pickJson('{"video_index": 0, "section_heading": "Section One"}'),
    );

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(searchVideos).toHaveBeenCalledWith('best widgets', expect.anything());
    const created = createArticle.mock.calls[0]![0] as {
      content: string;
      video: { video_id: string; section_heading: string };
    };
    expect(created.content).toContain('youtube-nocookie.com/embed/v1');
    expect(created.video).toEqual({
      video_id: 'v1',
      title: 'Widget basics',
      section_heading: 'Section One',
    });
  });

  test('toggle off: no search call, video null', async () => {
    findOrgById.mockResolvedValue({
      ...org,
      presets: {
        ...org.presets,
        article_preferences: {
          ...org.presets.article_preferences,
          engagement: { image_style: '', youtube_videos: false },
        },
      },
    });
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticleWithSection);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(searchVideos).not.toHaveBeenCalled();
    expect((createArticle.mock.calls[0]![0] as { video: unknown }).video).toBeNull();
  });

  test('video step failure is non-fatal: article persists with video null', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticleWithSection);
    searchVideos.mockRejectedValueOnce(new Error('quota exceeded'));

    await expect(
      handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {}),
    ).resolves.toBeUndefined();

    expect((createArticle.mock.calls[0]![0] as { video: unknown }).video).toBeNull();
    expect(failGeneration).not.toHaveBeenCalled();
  });

  test('LLM picking no video leaves content untouched', async () => {
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticleWithSection);
    searchVideos.mockResolvedValueOnce([candidate]);
    llmComplete.mockResolvedValueOnce(pickJson('{"video_index": null, "section_heading": null}'));

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    const created = createArticle.mock.calls[0]![0] as { content: string; video: unknown };
    expect(created.content).not.toContain('iframe');
    expect(created.video).toBeNull();
  });
});
