import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  claimGeneration,
  findKeywordById,
  failGeneration,
  linkArticle,
  findOrgById,
  createArticle,
  listByOrg,
  listPublishedByTopicCluster,
  listIntegrations,
} = vi.hoisted(() => ({
  claimGeneration: vi.fn(async () => true),
  findKeywordById: vi.fn(),
  failGeneration: vi.fn(async () => {}),
  linkArticle: vi.fn(async () => {}),
  findOrgById: vi.fn(),
  createArticle: vi.fn(async (_doc: unknown) => ({ id: 'art1' })),
  listByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
  listPublishedByTopicCluster: vi.fn(async () => [] as unknown[]),
  // Default: a static-site connection whose declared post base carries the
  // /blog prefix the older fixtures' expected URLs assume.
  listIntegrations: vi.fn(async () => [
    { provider: 'static-site', post_url_base: 'https://acme.com/blog' as string | null },
  ]),
}));
vi.mock('@shared/db', () => ({
  KeywordRepo: { claimGeneration, findById: findKeywordById, failGeneration, linkArticle },
  OrgRepo: { findById: findOrgById },
  ArticleRepo: { create: createArticle, listByOrg, listPublishedByTopicCluster },
  IntegrationRepo: { listByOrgId: listIntegrations },
}));

const { fleschKincaidGrade, generateArticle, verifyCandidates } = vi.hoisted(() => ({
  fleschKincaidGrade: vi.fn(() => 7.5 as number | null),
  generateArticle: vi.fn(),
  verifyCandidates: vi.fn(async (c: unknown[]) => c),
}));
vi.mock('@shared/generation', async (orig) => ({
  ...(await orig<typeof import('@shared/generation')>()),
  fleschKincaidGrade,
  generateArticle,
  verifyCandidates,
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

import { MAX_LINK_CANDIDATES } from '@shared/generation';
import { handler } from '../src/generation';
import { logger } from '../src/logger';

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
      engagement: { image_style: '', include_cta: true, youtube_videos: true },
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
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
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

  test('measures and logs readability for an exact-English article', async () => {
    const info = vi.spyOn(logger, 'info');
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(fleschKincaidGrade).toHaveBeenCalledWith(okArticle.article.content);
    expect(info).toHaveBeenCalledWith('article readability measured', {
      readability_metric: 'flesch_kincaid_grade',
      fk_grade: 7.5,
      fk_target: 8,
      fk_target_met: true,
    });
  });

  test('warns above target without failing, blocking creation, or blocking linking', async () => {
    const warn = vi.spyOn(logger, 'warn');
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    fleschKincaidGrade.mockReturnValueOnce(10.2);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(warn).toHaveBeenCalledWith('article readability above target', {
      readability_metric: 'flesch_kincaid_grade',
      fk_grade: 10.2,
      fk_target: 8,
      fk_target_met: false,
    });
    expect(createArticle).toHaveBeenCalledTimes(1);
    expect(linkArticle).toHaveBeenCalledWith('k1', 'art1');
    expect(failGeneration).not.toHaveBeenCalled();
  });

  test.each([
    'Turkish',
    'english',
  ])('does not measure or add FK log fields for language %s', async (language) => {
    const info = vi.spyOn(logger, 'info');
    const warn = vi.spyOn(logger, 'warn');
    findOrgById.mockResolvedValue({
      ...org,
      presets: {
        ...org.presets,
        business: { ...org.presets.business, language },
      },
    });
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(fleschKincaidGrade).not.toHaveBeenCalled();
    const loggedFields = [...info.mock.calls, ...warn.mock.calls].map((call) => call[1]);
    expect(loggedFields).not.toContainEqual(
      expect.objectContaining({ readability_metric: 'flesch_kincaid_grade' }),
    );
  });

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
      topic_cluster_id: null,
      topic_cluster_label: null,
      topic_role: null,
      topic_content_focus: null,
      topic_primary_keyword: null,
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
    expect(fleschKincaidGrade).not.toHaveBeenCalled();
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
    expect(fleschKincaidGrade).toHaveBeenCalledWith(okArticleWithSection.article.content);
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
          engagement: { image_style: '', include_cta: true, youtube_videos: false },
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

  test.each([
    'pillar',
    'support',
  ] as const)('copies exact %s Keyword topic metadata into the Article snapshot', async (role) => {
    const semanticKeyword = {
      ...keyword,
      keyword: 'membrane fouling',
      topic_cluster_id: 'topic:membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: role,
      topic_content_focus: 'What membrane fouling is and why it occurs',
      topic_primary_keyword: ' Membrane   Fouling ',
    };
    findOrgById.mockResolvedValue(org);
    findKeywordById.mockResolvedValue(semanticKeyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});
    semanticKeyword.topic_cluster_label = 'Changed after generation';

    expect(createArticle).toHaveBeenCalledWith(
      expect.objectContaining({
        topic_cluster_id: 'topic:membrane fouling',
        topic_cluster_label: 'Membrane fouling',
        topic_role: role,
        topic_content_focus: 'What membrane fouling is and why it occurs',
        topic_primary_keyword: ' Membrane   Fouling ',
      }),
    );
  });

  // main_blog_url deliberately stays empty: it is the blog INDEX, and after
  // #228 it plays no part in candidate URLs — the static-site integration's
  // post_url_base does.
  const linkingOrg = {
    ...org,
    presets: {
      ...org.presets,
      article_preferences: {
        ...org.presets.article_preferences,
        content_seo: { ...org.presets.article_preferences.content_seo, internal_links_count: 2 },
      },
    },
  };

  const staticPublication = (slug: string, published_at = new Date('2026-01-01')) => ({
    provider: 'static-site',
    slug,
    published_at,
    remote_url: 'https://github.com/acme/site/commit/abc',
  });

  const published = {
    id: 'article-published',
    org_id: 'o1',
    title: 'Widget Guide',
    slug: 'edited-later',
    status: 'published',
    publications: [staticPublication('widget-guide')],
    topic_cluster_id: null,
    topic_role: null,
  };

  const semanticKeyword = (role: 'pillar' | 'support') => ({
    ...keyword,
    keyword: 'membrane fouling',
    topic_cluster_id: 'topic:membrane fouling',
    topic_cluster_label: 'Membrane fouling',
    topic_role: role,
    topic_content_focus:
      role === 'pillar'
        ? 'What membrane fouling is and why it occurs'
        : 'How operators prevent membrane fouling',
    topic_primary_keyword: ' Membrane   Fouling ',
  });

  const publishedArticle = (
    title: string,
    slug: string,
    topicClusterId: string | null,
    topicRole: 'pillar' | 'support' | null,
    overrides: Record<string, unknown> = {},
  ) => ({
    ...published,
    id: `article-${slug}`,
    title,
    slug,
    publications: [staticPublication(slug)],
    topic_cluster_id: topicClusterId,
    topic_role: topicRole,
    ...overrides,
  });

  test('passes verified candidates from published articles into the context (#186)', async () => {
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listByOrg.mockResolvedValueOnce({ articles: [published], total: 1 });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listByOrg).toHaveBeenCalledWith('o1', expect.objectContaining({ status: 'published' }));
    expect(verifyCandidates).toHaveBeenCalledWith([
      {
        title: 'Widget Guide',
        url: 'https://acme.com/blog/widget-guide',
        topic_cluster_id: null,
        topic_role: null,
      },
    ]);
    const passed = generateArticle.mock.calls[0]![0] as {
      ctx: { linkCandidates: unknown[]; maxInternalLinks: number };
    };
    expect(passed.ctx.maxInternalLinks).toBe(2);
    expect(passed.ctx.linkCandidates).toEqual([
      {
        title: 'Widget Guide',
        url: 'https://acme.com/blog/widget-guide',
        topic_cluster_id: null,
        topic_role: null,
      },
    ]);
  });

  test('a candidate that fails verification never reaches the context (#186)', async () => {
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listByOrg.mockResolvedValueOnce({ articles: [published], total: 1 });
    verifyCandidates.mockResolvedValueOnce([]);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    const passed = generateArticle.mock.calls[0]![0] as { ctx: { linkCandidates: unknown[] } };
    expect(passed.ctx.linkCandidates).toEqual([]);
  });

  test('a support prioritizes its published pillar, then same-cluster pages, then general pages', async () => {
    const sameSupport = publishedArticle(
      'Same Support',
      'same-support',
      'topic:membrane fouling',
      'support',
    );
    const pillar = publishedArticle(
      'Cluster Pillar',
      'cluster-pillar',
      'topic:membrane fouling',
      'pillar',
    );
    const other = publishedArticle('Newer Unrelated', 'newer-unrelated', 'topic:other', 'pillar');
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(semanticKeyword('support'));
    generateArticle.mockResolvedValue(okArticle);
    listPublishedByTopicCluster
      .mockResolvedValueOnce([pillar])
      .mockResolvedValueOnce([sameSupport]);
    listByOrg.mockResolvedValueOnce({ articles: [other, sameSupport, pillar], total: 3 });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listPublishedByTopicCluster).toHaveBeenCalledWith('o1', 'topic:membrane fouling', {
      limit: MAX_LINK_CANDIDATES,
      role: { value: 'pillar', mode: 'include' },
    });
    expect(listPublishedByTopicCluster).toHaveBeenNthCalledWith(2, 'o1', 'topic:membrane fouling', {
      limit: MAX_LINK_CANDIDATES,
      role: { value: 'pillar', mode: 'exclude' },
    });
    const ordered = verifyCandidates.mock.calls[0]![0] as { title: string }[];
    expect(ordered.map((candidate) => candidate.title)).toEqual([
      'Cluster Pillar',
      'Same Support',
      'Newer Unrelated',
    ]);
  });

  test('a pillar prioritizes published supports while preserving repository order within tiers', async () => {
    const samePillar = publishedArticle(
      'Existing Pillar',
      'existing-pillar',
      'topic:membrane fouling',
      'pillar',
    );
    const supportOne = publishedArticle(
      'Support One',
      'support-one',
      'topic:membrane fouling',
      'support',
    );
    const supportTwo = publishedArticle(
      'Support Two',
      'support-two',
      'topic:membrane fouling',
      'support',
    );
    const other = publishedArticle('Other Cluster', 'other-cluster', 'topic:other', 'support');
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(semanticKeyword('pillar'));
    generateArticle.mockResolvedValue(okArticle);
    listPublishedByTopicCluster
      .mockResolvedValueOnce([supportOne, supportTwo])
      .mockResolvedValueOnce([samePillar]);
    listByOrg.mockResolvedValueOnce({ articles: [other], total: 1 });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    const ordered = verifyCandidates.mock.calls[0]![0] as { title: string }[];
    expect(ordered.map((candidate) => candidate.title)).toEqual([
      'Support One',
      'Support Two',
      'Existing Pillar',
      'Other Cluster',
    ]);
  });

  test('legacy Keywords retain the deterministic general published-page path', async () => {
    const older = publishedArticle('Older', 'older', null, null);
    const newer = publishedArticle('Newer', 'newer', null, null);
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listByOrg.mockResolvedValueOnce({ articles: [newer, older], total: 2 });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listPublishedByTopicCluster).not.toHaveBeenCalled();
    const ordered = verifyCandidates.mock.calls[0]![0] as { title: string }[];
    expect(ordered.map((candidate) => candidate.title)).toEqual(['Newer', 'Older']);
  });

  test('canonical duplicate URLs are removed before bounded verification', async () => {
    const pillar = publishedArticle(
      'Cluster Pillar',
      'same-url',
      'topic:membrane fouling',
      'pillar',
    );
    const duplicate = publishedArticle('Duplicate', 'same-url', 'topic:other', 'support', {
      publications: [staticPublication('/same-url/', new Date('2026-02-01'))],
    });
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(semanticKeyword('support'));
    generateArticle.mockResolvedValue(okArticle);
    listPublishedByTopicCluster.mockResolvedValueOnce([pillar]).mockResolvedValueOnce([]);
    listByOrg.mockResolvedValueOnce({ articles: [duplicate], total: 1 });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    const checked = verifyCandidates.mock.calls[0]![0] as { title: string }[];
    expect(checked.map((candidate) => candidate.title)).toEqual(['Cluster Pillar']);
  });

  test('caps verification and GenerationContext candidates at MAX_LINK_CANDIDATES', async () => {
    const same = publishedArticle(
      'Cluster Pillar',
      'cluster-pillar',
      'topic:membrane fouling',
      'pillar',
    );
    const general = Array.from({ length: MAX_LINK_CANDIDATES + 10 }, (_, index) =>
      publishedArticle(`General ${index}`, `general-${index}`, 'topic:other', 'support'),
    );
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(semanticKeyword('support'));
    generateArticle.mockResolvedValue(okArticle);
    listPublishedByTopicCluster.mockResolvedValueOnce([same]);
    listByOrg.mockResolvedValueOnce({ articles: general, total: general.length });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listByOrg).toHaveBeenCalledWith('o1', {
      status: 'published',
      limit: MAX_LINK_CANDIDATES,
      offset: 0,
    });
    expect(verifyCandidates.mock.calls[0]![0]).toHaveLength(MAX_LINK_CANDIDATES);
    const passed = generateArticle.mock.calls[0]![0] as {
      ctx: { linkCandidates: unknown[] };
    };
    expect(passed.ctx.linkCandidates).toHaveLength(MAX_LINK_CANDIDATES);
  });

  test('unpublished, cross-org, invalid, and failed-verification rows never reach generation', async () => {
    const unpublished = publishedArticle('Draft', 'draft', null, null, { status: 'generated' });
    const crossOrg = publishedArticle('Cross Org', 'cross-org', null, null, { org_id: 'o2' });
    const invalid = publishedArticle('Invalid URL', '', null, null, { publications: [] });
    const failsVerification = publishedArticle('Fails Live Check', 'fails-live', null, null);
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listByOrg.mockResolvedValueOnce({
      articles: [unpublished, crossOrg, invalid, failsVerification],
      total: 4,
    });
    verifyCandidates.mockResolvedValueOnce([]);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(verifyCandidates).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Fails Live Check' }),
    ]);
    const passed = generateArticle.mock.calls[0]![0] as {
      ctx: { linkCandidates: unknown[] };
    };
    expect(passed.ctx.linkCandidates).toEqual([]);
  });

  test('an org with internal_links_count 0 queries nothing (#186)', async () => {
    findOrgById.mockResolvedValue(org); // fixture has internal_links_count: 0
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listByOrg).not.toHaveBeenCalled();
    expect(listPublishedByTopicCluster).not.toHaveBeenCalled();
    expect(verifyCandidates).not.toHaveBeenCalled();
    const passed = generateArticle.mock.calls[0]![0] as { ctx: { linkCandidates: unknown[] } };
    expect(passed.ctx.linkCandidates).toEqual([]);
  });

  test('a wordpress publication contributes its stored permalink (#228)', async () => {
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listIntegrations.mockResolvedValueOnce([]);
    listByOrg.mockResolvedValueOnce({
      articles: [
        {
          ...published,
          publications: [
            {
              provider: 'wordpress',
              slug: 'widget-guide',
              published_at: new Date('2026-01-01'),
              remote_url: 'https://acme.com/archives/widget-guide',
            },
          ],
        },
      ],
      total: 1,
    });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(verifyCandidates).toHaveBeenCalledWith([
      expect.objectContaining({ url: 'https://acme.com/archives/widget-guide' }),
    ]);
  });

  test('a static-site connection without a post base derives nothing and warns (#228)', async () => {
    const warn = vi.spyOn(logger, 'warn');
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listIntegrations.mockResolvedValueOnce([{ provider: 'static-site', post_url_base: null }]);
    listByOrg.mockResolvedValueOnce({ articles: [published], total: 1 });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    const passed = generateArticle.mock.calls[0]![0] as { ctx: { linkCandidates: unknown[] } };
    expect(passed.ctx.linkCandidates).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no usable'),
      expect.objectContaining({ published: 1, derived: 0, verified: 0 }),
    );
  });

  test('published articles that all fail verification warn instead of staying silent (#228)', async () => {
    const warn = vi.spyOn(logger, 'warn');
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listByOrg.mockResolvedValueOnce({ articles: [published], total: 1 });
    verifyCandidates.mockResolvedValueOnce([]);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('no usable'),
      expect.objectContaining({ published: 1, derived: 1, verified: 0 }),
    );
  });

  test('an org that published nothing gets zero links without a warning (#228)', async () => {
    const warn = vi.spyOn(logger, 'warn');
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listByOrg.mockResolvedValueOnce({ articles: [], total: 0 });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    const passed = generateArticle.mock.calls[0]![0] as { ctx: { linkCandidates: unknown[] } };
    expect(passed.ctx.linkCandidates).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
