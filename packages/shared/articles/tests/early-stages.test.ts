import type { LlmClient } from '@shared/providers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { findOrgById, listIntegrations, listByOrg, listPublishedByTopicCluster } = vi.hoisted(
  () => ({
    findOrgById: vi.fn(),
    listIntegrations: vi.fn(async () => [] as { provider: string; post_url_base: string | null }[]),
    listByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
    listPublishedByTopicCluster: vi.fn(async () => [] as unknown[]),
  }),
);
vi.mock('@shared/db', () => ({
  OrgRepo: { findById: findOrgById },
  IntegrationRepo: { listByOrgId: listIntegrations },
  ArticleRepo: { listByOrg, listPublishedByTopicCluster },
}));

vi.mock('@shared/generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/generation')>()),
  verifyCandidates: vi.fn(async (c: unknown[]) => c),
}));

import { OUTLINE_RESPONSE_SCHEMA } from '@shared/generation';
import { ArticleFatalError } from '../src/errors';
import { stageDraft } from '../src/stages/draft';
import { stageOutline } from '../src/stages/outline';
import { stagePrepare } from '../src/stages/prepare';
import { makeRun, org, outlineJson, presets } from './fixtures';

function llmReplying(text: string): LlmClient {
  return {
    complete: vi.fn(async () => ({
      text,
      model: 'test',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0.01 },
    })),
  };
}

describe('stagePrepare', () => {
  beforeEach(() => vi.clearAllMocks());

  test('throws ArticleFatalError when the org is missing', async () => {
    findOrgById.mockResolvedValue(null);
    await expect(stagePrepare(makeRun())).rejects.toThrow(ArticleFatalError);
  });

  test('throws ArticleFatalError when presets are null', async () => {
    findOrgById.mockResolvedValue({ ...org, presets: undefined });
    await expect(stagePrepare(makeRun())).rejects.toThrow(ArticleFatalError);
  });

  test('throws ArticleFatalError when the org is not paid', async () => {
    findOrgById.mockResolvedValue({ ...org, plan: 'free' });
    await expect(stagePrepare(makeRun())).rejects.toThrow(ArticleFatalError);
  });

  test('resolves link candidates from published articles and returns them on working', async () => {
    const linkingOrg = {
      ...org,
      presets: {
        ...presets,
        article_preferences: {
          ...presets.article_preferences,
          content_seo: { ...presets.article_preferences.content_seo, internal_links_count: 2 },
        },
      },
    };
    findOrgById.mockResolvedValue(linkingOrg);
    listIntegrations.mockResolvedValue([
      { provider: 'static-site', post_url_base: 'https://acme.com/blog' },
    ]);
    listByOrg.mockResolvedValueOnce({
      articles: [
        {
          id: 'article-published',
          org_id: 'o1',
          title: 'Widget Guide',
          slug: 'edited-later',
          status: 'published',
          publications: [
            {
              provider: 'static-site',
              slug: 'widget-guide',
              published_at: new Date('2026-01-01'),
              remote_url: 'https://github.com/acme/site/commit/abc',
            },
          ],
          topic_cluster_id: null,
          topic_role: null,
        },
      ],
      total: 1,
    });

    const result = await stagePrepare(makeRun());

    expect(result).toEqual({
      completed: true,
      working: {
        link_candidates: [
          {
            title: 'Widget Guide',
            url: 'https://acme.com/blog/widget-guide/',
            topic_cluster_id: null,
            topic_role: null,
          },
        ],
      },
    });
    expect(listPublishedByTopicCluster).not.toHaveBeenCalled();
  });
});

describe('stageOutline', () => {
  test('calls llm.complete with OUTLINE_RESPONSE_SCHEMA, parses, and returns the outline', async () => {
    const llm = llmReplying(outlineJson);

    const result = await stageOutline(makeRun(), llm);

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        responseSchema: OUTLINE_RESPONSE_SCHEMA,
        model: 'google/gemini-2.5-flash',
        timeoutMs: 60_000,
      }),
    );
    expect(result.completed).toBe(true);
    expect(result.working.outline).toMatchObject({
      h1: 'Best Widgets For Makers',
      slug: 'best-widgets',
    });
  });

  test('routes the outline model by the run snapshot content_complexity', async () => {
    const llm = llmReplying(outlineJson);
    const technical = makeRun({
      presets: {
        ...presets,
        article_preferences: {
          ...presets.article_preferences,
          content_seo: {
            ...presets.article_preferences.content_seo,
            content_complexity: 'technical',
          },
        },
      },
    });

    await stageOutline(technical, llm);

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deepseek/deepseek-v4-pro-0813',
        timeoutMs: 180_000,
        reasoningEffort: 'low',
      }),
    );
  });
});

describe('stageDraft', () => {
  test('throws ArticleFatalError when working.outline is null', async () => {
    const llm = llmReplying('unused');
    await expect(stageDraft(makeRun(), llm)).rejects.toThrow(ArticleFatalError);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  const outline = {
    h1: 'Best Widgets For Makers',
    meta_title: 'Best Widgets For Makers 2026',
    meta_description: 'x'.repeat(140),
    slug: 'best-widgets',
    sections: [{ heading: 'One', intent: 'i' }],
    faqs: [],
    internal_links: [],
    cta: 'Compare the best option for your needs.',
  };

  test('returns the draft text from the llm when an outline is checkpointed', async () => {
    const llm = llmReplying('<llm text>');
    const run = makeRun({ working: { outline } });

    const result = await stageDraft(run, llm);

    expect(result).toEqual({ completed: true, working: { draft: '<llm text>' } });
  });

  test('strips an H1 the model opens with anyway: the page renders the title', async () => {
    const llm = llmReplying('# Best Widgets For Makers\n\nIntro.\n\n## One\n\nBody.');
    const run = makeRun({ working: { outline } });

    const result = await stageDraft(run, llm);

    expect(result.working).toEqual({ draft: 'Intro.\n\n## One\n\nBody.' });
  });

  test('routes the draft model by the run snapshot content_complexity', async () => {
    const llm = llmReplying('## One\n\nbody');
    const technical = makeRun({
      working: { outline },
      presets: {
        ...presets,
        article_preferences: {
          ...presets.article_preferences,
          content_seo: {
            ...presets.article_preferences.content_seo,
            content_complexity: 'technical',
          },
        },
      },
    });

    await stageDraft(technical, llm);

    expect(llm.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'qwen/qwen3.8-max-0902',
        timeoutMs: 300_000,
        reasoningEffort: 'low',
      }),
    );
  });
});
