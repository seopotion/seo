import type { LlmClient, YouTubeClient } from '@shared/providers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { createArticle, findLatestForKeywordSince, linkArticle } = vi.hoisted(() => ({
  createArticle: vi.fn(async (_doc: unknown) => ({ id: 'a1' })),
  findLatestForKeywordSince: vi.fn(
    async (_orgId: string, _keywordId: string, _since: Date): Promise<{ id: string } | null> =>
      null,
  ),
  linkArticle: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({
  ArticleRepo: { create: createArticle, findLatestForKeywordSince },
  KeywordRepo: { linkArticle },
}));

import { ArticleFatalError } from '../src/errors';
import { stageFinalize } from '../src/stages/finalize';
import { keyword, makeRun, presets } from './fixtures';

// Copied from packages/shared/generation/tests/generate.test.ts — clears
// WORD_COUNT_FLOOR (800) and carries two distinct H2 sections.
const content = `${'Intro paragraph words here. '.repeat(20)}\n\n## One\n\n${'Body one content unique. '.repeat(100)}\n\n## Two\n\n${'Body two content unique. '.repeat(100)}\n`;

const outline = {
  h1: 'Best Widgets For Makers',
  meta_title: 'Best Widgets For Makers 2026',
  meta_description: 'x'.repeat(140),
  slug: 'best-widgets',
  sections: [
    { heading: 'One', intent: 'i' },
    { heading: 'Two', intent: 'i' },
  ],
  faqs: [],
  internal_links: [],
  cta: 'Compare the best option for your needs.',
};

const presetsNoVideo = {
  ...presets,
  article_preferences: {
    ...presets.article_preferences,
    engagement: { ...presets.article_preferences.engagement, youtube_videos: false },
  },
};

function llmReplying(...texts: string[]): LlmClient {
  const complete = vi.fn();
  for (const text of texts) {
    complete.mockResolvedValueOnce({
      text,
      model: 'test',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0.01 },
    });
  }
  return { complete };
}

/** Per-rule semantic verdict (#277); `pass` is derived, never sent by the judge. */
const cleanVerdict = {
  unsupported_claims: { violated: false, detail: '' },
  competitor_promotion: { violated: false, competitor: '', detail: '' },
  keyword_use: { violated: false, detail: '' },
  call_to_action: { violated: false, detail: '' },
  topic_scope: { violated: false, detail: '' },
  language: { violated: false, detail: '' },
};
const verdict = (patch: Record<string, unknown> = {}) =>
  JSON.stringify({ ...cleanVerdict, ...patch });
const semanticPass = verdict();

function youtubeThat(impl?: () => Promise<never>): YouTubeClient {
  return { searchVideos: vi.fn(impl ?? (async () => [])) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stageFinalize', () => {
  test('strips a leading H1 the humanize pass added back, instead of failing the run', async () => {
    const llm = llmReplying(semanticPass);
    const youtube = youtubeThat();
    const run = makeRun({
      working: { outline, content: `# ${outline.h1}\n\n${content}`, readability_grade: 6 },
      presets: presetsNoVideo,
    });

    await stageFinalize(run, { llm, youtube });

    expect(createArticle).toHaveBeenCalledTimes(1);
    expect(createArticle).toHaveBeenCalledWith(expect.objectContaining({ content }));
  });

  test('happy path: creates the article with the readability object and links the keyword', async () => {
    const llm = llmReplying(semanticPass);
    const youtube = youtubeThat();
    const run = makeRun({
      working: {
        outline,
        content,
        readability_grade: 6,
        humanize_attempts: [{ attempt: 1, grade: 6, content }],
      },
      presets: presetsNoVideo,
    });

    const result = await stageFinalize(run, { llm, youtube });

    expect(createArticle).toHaveBeenCalledTimes(1);
    expect(createArticle).toHaveBeenCalledWith({
      org_id: 'o1',
      keyword_id: keyword.id,
      title: outline.h1,
      meta_title: outline.meta_title,
      slug: outline.slug,
      keyword: keyword.keyword,
      topic_cluster_id: keyword.topic_cluster_id,
      topic_cluster_label: keyword.topic_cluster_label,
      topic_role: keyword.topic_role,
      topic_content_focus: keyword.topic_content_focus,
      topic_primary_keyword: keyword.topic_primary_keyword,
      meta_description: outline.meta_description,
      featured_image_url: '',
      content,
      video: null,
      difficulty: keyword.difficulty,
      search_volume: keyword.search_volume,
      status: 'generated',
      published_at: null,
      readability: {
        metric: 'flesch_kincaid_grade',
        grade: 6,
        target: 8,
        target_met: true,
        attempts: 1,
      },
    });
    expect(linkArticle).toHaveBeenCalledWith(keyword.id, 'a1');
    expect(result).toEqual({ completed: true, working: { article_id: 'a1' } });
  });

  test('semantic failure throws ArticleFatalError and creates no article', async () => {
    const llm = llmReplying(verdict({ keyword_use: { violated: true, detail: 'keyword absent' } }));
    const youtube = youtubeThat();
    const run = makeRun({
      working: { outline, content, readability_grade: 6 },
      presets: presetsNoVideo,
    });

    await expect(stageFinalize(run, { llm, youtube })).rejects.toThrow(
      new ArticleFatalError('validation: semantic: keyword_use: keyword absent'),
    );
    expect(createArticle).not.toHaveBeenCalled();
  });

  // #277: the judge naming the org's own brand as "a competitor" used to throw
  // away the finished article. The org lists no competitors, so nothing it names
  // can be one.
  test('a competitor claim naming a business outside the org list does not fail the article', async () => {
    const llm = llmReplying(
      verdict({
        competitor_promotion: {
          violated: true,
          competitor: 'Acme',
          detail: 'the conclusion recommends Acme',
        },
      }),
    );
    const run = makeRun({
      working: { outline, content, readability_grade: 6 },
      presets: presetsNoVideo,
    });

    const result = await stageFinalize(run, { llm, youtube: youtubeThat() });

    expect(createArticle).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ completed: true, working: { article_id: 'a1' } });
  });

  test('the thrown message carries every failure reason, not just the codes', async () => {
    const llm = llmReplying(
      verdict({
        keyword_use: { violated: true, detail: 'keyword absent' },
        call_to_action: { violated: true, detail: 'no CTA' },
      }),
    );
    const youtube = youtubeThat();
    const run = makeRun({
      working: { outline, content: `${content}\n\n# Stray H1\n`, readability_grade: 6 },
      presets: presetsNoVideo,
    });

    await expect(stageFinalize(run, { llm, youtube })).rejects.toThrow(
      new ArticleFatalError(
        'validation: h1_count: expected no H1 (the page renders the title), found 1 | semantic: keyword_use: keyword absent; call_to_action: no CTA',
      ),
    );
    expect(createArticle).not.toHaveBeenCalled();
  });

  test('redrive guard: article_id already set returns immediately without creating', async () => {
    const complete = vi.fn(() => {
      throw new Error('must not be called');
    });
    const llm: LlmClient = { complete };
    const youtube = youtubeThat();
    const run = makeRun({ working: { outline, content, article_id: 'existing-1' } });

    const result = await stageFinalize(run, { llm, youtube });

    expect(result).toEqual({ completed: true, working: { article_id: 'existing-1' } });
    expect(createArticle).not.toHaveBeenCalled();
    expect(linkArticle).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  // #67: the checkpoint is written after create + link, so a crash in between
  // used to redrive into a second article (orphaning the first).
  test('redrive guard: an article this run already created is reused, not duplicated', async () => {
    const complete = vi.fn(() => {
      throw new Error('must not be called');
    });
    const llm: LlmClient = { complete };
    const youtube = youtubeThat();
    findLatestForKeywordSince.mockResolvedValueOnce({ id: 'orphan-1' });
    const run = makeRun({ working: { outline, content, readability_grade: 6 } });

    const result = await stageFinalize(run, { llm, youtube });

    expect(findLatestForKeywordSince).toHaveBeenCalledWith('o1', keyword.id, run.created_at);
    expect(createArticle).not.toHaveBeenCalled();
    expect(linkArticle).toHaveBeenCalledWith(keyword.id, 'orphan-1');
    expect(result).toEqual({ completed: true, working: { article_id: 'orphan-1' } });
    expect(complete).not.toHaveBeenCalled();
  });

  test('video step failure is swallowed: article still created with video null', async () => {
    const llm = llmReplying(semanticPass);
    const youtube = youtubeThat(async () => {
      throw new Error('quota exceeded');
    });
    const run = makeRun({
      working: { outline, content, readability_grade: 6 },
      // default fixture presets have youtube_videos: true
    });

    const result = await stageFinalize(run, { llm, youtube });

    expect(youtube.searchVideos).toHaveBeenCalledTimes(1);
    expect(createArticle).toHaveBeenCalledTimes(1);
    expect(createArticle.mock.calls[0]![0]).toMatchObject({ video: null });
    expect(result).toEqual({ completed: true, working: { article_id: 'a1' } });
  });

  test('grade above target stamps target_met: false', async () => {
    const llm = llmReplying(semanticPass);
    const youtube = youtubeThat();
    const attempts = [
      { attempt: 1, grade: 14, content: 'x' },
      { attempt: 2, grade: 10, content: 'y' },
      { attempt: 3, grade: 9.4, content },
    ];
    const run = makeRun({
      working: { outline, content, readability_grade: 9.4, humanize_attempts: attempts },
      presets: presetsNoVideo,
    });

    await stageFinalize(run, { llm, youtube });

    expect(createArticle.mock.calls[0]![0]).toMatchObject({
      readability: {
        metric: 'flesch_kincaid_grade',
        grade: 9.4,
        target: 8,
        target_met: false,
        attempts: 3,
      },
    });
  });

  test('routes the semantic check and the video pick to the finalize task (Haiku at every complexity)', async () => {
    // Default fixture presets have youtube_videos: true; one candidate makes
    // the stage also issue the video-pick call (#358 covers its route too).
    const llm = llmReplying(
      semanticPass,
      JSON.stringify({ video_index: 0, section_heading: 'One' }),
    );
    const youtube: YouTubeClient = {
      searchVideos: vi.fn(async () => [
        { video_id: 'v1', title: 'Vid title', description: 'd', channel: 'c' },
      ]),
    };
    const runOverrides = {
      working: {
        outline,
        content,
        readability_grade: 6,
        humanize_attempts: [{ attempt: 1, grade: 6, content }],
      },
      presets: presetsNoVideo,
    };
    const technical = makeRun({
      ...runOverrides,
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

    await stageFinalize(technical, { llm, youtube });

    expect(llm.complete).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ model: 'anthropic/claude-haiku-4.5', timeoutMs: 60_000 }),
    );
    expect(llm.complete).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ model: 'anthropic/claude-haiku-4.5', timeoutMs: 60_000 }),
    );
  });

  test('stores the org readability target on the article (#313)', async () => {
    const llm = llmReplying(semanticPass);
    const youtube = youtubeThat();
    const technical = {
      ...presetsNoVideo,
      article_preferences: {
        ...presetsNoVideo.article_preferences,
        content_seo: {
          ...presetsNoVideo.article_preferences.content_seo,
          readability_grade_max: 12,
        },
      },
    };
    const run = makeRun({
      working: {
        outline,
        content,
        readability_grade: 10,
        humanize_attempts: [{ attempt: 1, grade: 10, content }],
      },
      presets: technical,
    });

    await stageFinalize(run, { llm, youtube });

    expect(createArticle.mock.calls[0]![0]).toMatchObject({
      readability: { grade: 10, target: 12, target_met: true, attempts: 1 },
    });
  });
});
