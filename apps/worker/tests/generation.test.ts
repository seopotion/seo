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
} = vi.hoisted(() => ({
  claimGeneration: vi.fn(async () => true),
  findKeywordById: vi.fn(),
  failGeneration: vi.fn(async () => {}),
  linkArticle: vi.fn(async () => {}),
  findOrgById: vi.fn(),
  createArticle: vi.fn(async (_doc: unknown) => ({ id: 'art1' })),
  listByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
  listPublishedByTopicCluster: vi.fn(async () => [] as unknown[]),
}));
vi.mock('@shared/db', () => ({
  KeywordRepo: { claimGeneration, findById: findKeywordById, failGeneration, linkArticle },
  OrgRepo: { findById: findOrgById },
  ArticleRepo: { create: createArticle, listByOrg, listPublishedByTopicCluster },
}));

const { generateArticle, verifyCandidates } = vi.hoisted(() => ({
  generateArticle: vi.fn(),
  verifyCandidates: vi.fn(async (c: unknown[]) => c),
}));
vi.mock('@shared/generation', async (orig) => ({
  ...(await orig<typeof import('@shared/generation')>()),
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

  const linkingOrg = {
    ...org,
    presets: {
      ...org.presets,
      blog: { sitemap_url: '', main_blog_url: 'https://acme.com/blog', best_articles: [] },
      article_preferences: {
        ...org.presets.article_preferences,
        content_seo: { ...org.presets.article_preferences.content_seo, internal_links_count: 2 },
      },
    },
  };

  const published = {
    id: 'article-published',
    org_id: 'o1',
    title: 'Widget Guide',
    slug: 'edited-later',
    status: 'published',
    publications: [{ slug: 'widget-guide', published_at: new Date('2026-01-01') }],
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
    publications: [{ slug, published_at: new Date('2026-01-01') }],
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
      publications: [{ slug: '/same-url/', published_at: new Date('2026-02-01') }],
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

  test('an org with no main_blog_url gets no candidates (#186)', async () => {
    findOrgById.mockResolvedValue({
      ...linkingOrg,
      presets: {
        ...linkingOrg.presets,
        blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
      },
    });
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listByOrg).not.toHaveBeenCalled();
    expect(listPublishedByTopicCluster).not.toHaveBeenCalled();
    expect(verifyCandidates).not.toHaveBeenCalled();
  });
});
