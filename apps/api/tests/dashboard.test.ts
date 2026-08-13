import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  editWordPressArticle,
  saveWordPressConnection,
  setWordPressPostId,
  submitWordPressArticle,
  testWordPressIntegration,
} = vi.hoisted(() => ({
  editWordPressArticle: vi.fn(),
  saveWordPressConnection: vi.fn(),
  setWordPressPostId: vi.fn(),
  submitWordPressArticle: vi.fn(),
  testWordPressIntegration: vi.fn(),
}));

const { enqueuePublishTask } = vi.hoisted(() => ({
  enqueuePublishTask: vi.fn(async () => {}),
}));
vi.mock('../src/clients/sqs', () => ({ enqueuePublishTask }));

// Google verification is mocked — no network, no real token needed.
vi.mock('../src/clients/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g-sub-123', email: 'u@example.com', name: 'U' })),
}));

vi.mock('../src/clients/wordpress', () => ({
  editWordPressArticle,
  submitWordPressArticle,
  testWordPressIntegration,
}));

// The static-site publisher (#7). GithubError has to be the same class the route
// does `instanceof` against, so it is declared here and handed to both.
const { commitFiles, GithubError } = vi.hoisted(() => {
  class GithubError extends Error {
    constructor(
      readonly code: string,
      message: string,
    ) {
      super(message);
    }
  }
  return { commitFiles: vi.fn(), GithubError };
});
vi.mock('../src/clients/github', () => ({ commitFiles, GithubError }));

const { backlinksSummary } = vi.hoisted(() => ({
  backlinksSummary: vi.fn(async (_target: string) => ({ rank: 730 })),
}));
vi.mock('../src/clients/providers', () => ({
  getDataForSeoClient: () => ({ backlinksSummary }),
}));

const { querySearchAnalytics, GscAuthRevokedError } = vi.hoisted(() => {
  class GscAuthRevokedError extends Error {}
  return { querySearchAnalytics: vi.fn(), GscAuthRevokedError };
});
vi.mock('../src/clients/gsc', () => ({ querySearchAnalytics, GscAuthRevokedError }));

const gscKey = vi.hoisted(() => Buffer.alloc(32, 7));
vi.mock('../src/lib/secrets', () => ({ getGscTokenKey: vi.fn(async () => gscKey) }));

// #7: connections keyed `${org_id}:${provider}`, matching the collection's
// unique index. Hoisted so tests can reset it between cases.
const { integrations } = vi.hoisted(() => ({
  integrations: new Map<string, Record<string, unknown>>(),
}));

const { gscConnections, markRefreshFailed } = vi.hoisted(() => ({
  gscConnections: new Map<string, Record<string, unknown>>(),
  markRefreshFailed: vi.fn(async (orgId: string) => {
    const c = gscConnections.get(orgId);
    if (c) c.last_refresh_failed_at = new Date();
  }),
}));

vi.mock('@shared/db', () => {
  // org_1 (owned by user_1) has data; org_2 (also user_1) is empty.
  const now = new Date('2026-07-02T08:00:00.000Z');
  const keywords = [
    {
      id: 'kw_1',
      org_id: 'org_1',
      // Legacy entry: no candidate linkage/classification (#99 nullable fields).
      candidate_id: null,
      keyword: 'landing pages',
      status: 'scheduled',
      scheduled_date: '2026-07-02',
      search_volume: 170,
      difficulty: 36,
      article_type: null,
      intent: null,
      opportunity_score: null,
      generation_status: 'generated',
      generation_error: null,
      article_id: 'art_1',
      created_at: now,
    },
    {
      id: 'kw_2',
      org_id: 'org_1',
      candidate_id: 'cand_2',
      keyword: 'notion builder',
      status: 'scheduled',
      scheduled_date: '2026-07-03',
      search_volume: 2400,
      difficulty: 48,
      article_type: 'how_to_guide',
      intent: 'informational',
      opportunity_score: 0.7,
      generation_status: 'pending',
      generation_error: null,
      article_id: null,
      created_at: now,
    },
  ];
  const articles = [
    {
      id: 'art_1',
      org_id: 'org_1',
      keyword_id: 'kw_1',
      title: 'Landing Pages',
      meta_title: 'Landing Pages Guide',
      slug: 'landing-pages',
      keyword: 'landing pages',
      meta_description: 'm',
      featured_image_url: 'https://x/1.png',
      content: '# a',
      difficulty: 36,
      search_volume: 170,
      status: 'generated',
      images_status: 'complete',
      created_at: now,
      updated_at: null,
      published_at: null,
      video: { video_id: 'v1', title: 'Widget basics', section_heading: 'Intro' },
    },
    {
      id: 'art_2',
      org_id: 'org_1',
      keyword_id: 'kw_2',
      title: 'Notion Builder',
      meta_title: 'Notion Builder',
      slug: 'notion-builder',
      keyword: 'notion builder',
      meta_description: 'm',
      featured_image_url: 'https://x/2.png',
      content: '# b',
      difficulty: 48,
      search_volume: 2400,
      status: 'published',
      images_status: 'complete',
      created_at: now,
      updated_at: now,
      published_at: now,
      wordpress_post_id: 222,
      publications: [
        {
          provider: 'wordpress',
          ref: '222',
          slug: 'notion-builder',
          published_at: now,
          updated_at: null,
        },
      ],
      video: null,
    },
    // Owned by org_3 (user_2) — never visible to user_1 via detail reads.
    {
      id: 'art_3',
      org_id: 'org_3',
      keyword_id: 'kw_9',
      title: 'Foreign Article',
      meta_title: 'Foreign Article',
      slug: 'foreign-article',
      keyword: 'foreign',
      meta_description: 'm',
      featured_image_url: 'https://x/3.png',
      content: '# c',
      difficulty: 10,
      search_volume: 50,
      status: 'generated',
      images_status: 'pending',
      created_at: now,
      updated_at: null,
      published_at: null,
      video: null,
    },
    {
      id: 'art_4',
      org_id: 'org_2',
      keyword_id: 'kw_4',
      title: 'Disconnected Article',
      slug: 'disconnected-article',
      keyword: 'disconnected',
      meta_description: 'm',
      featured_image_url: 'https://x/4.png',
      content: '# d',
      difficulty: 10,
      search_volume: 50,
      status: 'generated',
      images_status: 'complete',
      created_at: now,
      updated_at: null,
      published_at: null,
      video: null,
    },
    {
      id: 'art_5',
      org_id: 'org_1',
      keyword_id: 'kw_5',
      title: 'Images Pending',
      slug: 'images-pending',
      keyword: 'images pending',
      meta_description: 'm',
      featured_image_url: '',
      content: '# e',
      difficulty: 10,
      search_volume: 50,
      status: 'generated',
      images_status: 'pending',
      created_at: now,
      updated_at: null,
      published_at: null,
      video: null,
    },
    // Already submitted to WordPress (has a post ID) but images regressed to
    // pending — exercises the update-readiness guard.
    {
      id: 'art_6',
      org_id: 'org_1',
      keyword_id: 'kw_6',
      title: 'Submitted Images Pending',
      slug: 'submitted-images-pending',
      keyword: 'submitted images pending',
      meta_description: 'm',
      featured_image_url: '',
      content: '# f',
      difficulty: 10,
      search_volume: 50,
      status: 'generated',
      images_status: 'pending',
      created_at: now,
      updated_at: null,
      published_at: null,
      wordpress_post_id: 555,
      video: null,
    },
    // Static-site fixtures (#7). Unlike the rows above these carry `images` and
    // `publications`, because the publisher reads both — the repo defaults them
    // through Zod, which this hand-rolled mock does not do.
    {
      id: 'art_7',
      org_id: 'org_1',
      keyword_id: 'kw_7',
      title: 'Never Published',
      meta_title: 'Never Published',
      slug: 'never-published',
      keyword: 'never published',
      meta_description: 'm',
      featured_image_url: 'https://cdn.example/7/cover.webp',
      content: '## Section\n\nBody.',
      difficulty: 10,
      search_volume: 50,
      status: 'generated',
      images: [
        {
          role: 'cover',
          section_heading: null,
          prompt: 'p',
          alt: 'Cover alt',
          url: 'https://cdn.example/7/cover.webp',
          model: null,
          seed: null,
          generated_at: now,
        },
      ],
      images_status: 'complete',
      created_at: now,
      updated_at: null,
      published_at: null,
      publications: [] as Record<string, unknown>[],
      video: null,
    },
    // Published to the static site, then renamed in the editor: the repo still
    // holds `old-guide.md`, so republishing must delete it in the same commit.
    {
      id: 'art_8',
      org_id: 'org_1',
      keyword_id: 'kw_8',
      title: 'Renamed Guide',
      meta_title: 'Renamed Guide',
      slug: 'renamed-guide',
      keyword: 'renamed guide',
      meta_description: 'm',
      featured_image_url: 'https://cdn.example/8/cover.webp',
      content: '## Section\n\nBody.',
      difficulty: 10,
      search_volume: 50,
      status: 'generated',
      images: [],
      images_status: 'complete',
      created_at: now,
      updated_at: null,
      published_at: null,
      publications: [
        {
          provider: 'static-site',
          ref: 'sha-old',
          slug: 'old-guide',
          published_at: new Date('2026-07-01T00:00:00.000Z'),
          updated_at: null,
        },
      ] as Record<string, unknown>[],
      video: null,
    },
    // Collides with art_8's committed filename.
    {
      id: 'art_9',
      org_id: 'org_1',
      keyword_id: 'kw_9',
      title: 'Slug Twin',
      meta_title: 'Slug Twin',
      slug: 'old-guide',
      keyword: 'slug twin',
      meta_description: 'm',
      featured_image_url: 'https://cdn.example/9/cover.webp',
      content: '## Section\n\nBody.',
      difficulty: 10,
      search_volume: 50,
      status: 'generated',
      images: [],
      images_status: 'complete',
      created_at: now,
      updated_at: null,
      published_at: null,
      publications: [] as Record<string, unknown>[],
      video: null,
    },
  ];
  const orgs = new Map<string, Record<string, unknown>>([
    [
      'org_1',
      {
        id: 'org_1',
        user_id: 'user_1',
        website_url: 'https://clewas.com',
        setup_status: 'setup_complete',
        strategy_status: 'completed',
        wordpress_token: 'stored-site-token',
        wordpress_connected_at: now,
        presets: {
          business: {
            name: 'Clewas',
            language: 'English',
            country: 'Global (English)',
            description: 'desc',
          },
          audience: { target: ['creators'], competitors: ['super.so', 'potion.so'] },
          blog: {
            sitemap_url: 'https://x/sitemap.xml',
            main_blog_url: 'https://x/blog',
            best_articles: [],
          },
          article_preferences: {
            content_seo: {
              article_style: 'Informative',
              internal_links_count: 1,
              table_of_contents: true,
              llm_instructions: 'x',
            },
            engagement: { image_style: 'Sketch', youtube_videos: true },
            publishing: { auto_publish: false },
          },
        },
        domain_rating: { value: 41, checked_at: new Date() },
        created_at: now,
      },
    ],
    [
      'org_2',
      {
        id: 'org_2',
        user_id: 'user_1',
        website_url: 'https://empty.com',
        setup_status: 'setup_complete',
        presets: {
          business: {
            name: 'Clewas',
            language: 'English',
            country: 'Global (English)',
            description: 'desc',
          },
          audience: { target: ['creators'], competitors: ['super.so', 'potion.so'] },
          blog: {
            sitemap_url: 'https://x/sitemap.xml',
            main_blog_url: 'https://x/blog',
            best_articles: [],
          },
          article_preferences: {
            content_seo: {
              article_style: 'Informative',
              internal_links_count: 1,
              table_of_contents: true,
              llm_instructions: 'x',
            },
            engagement: { image_style: 'Sketch', youtube_videos: true },
            publishing: { auto_publish: false },
          },
        },
        created_at: now,
      },
    ],
    // Owned by a different user — used to prove ownership 404s don't leak.
    [
      'org_3',
      { id: 'org_3', user_id: 'user_2', website_url: 'https://other.com', created_at: now },
    ],
    [
      'org_stale',
      {
        id: 'org_stale',
        user_id: 'user_1',
        website_url: 'https://www.stale.com',
        setup_status: 'setup_complete',
        domain_rating: { value: 12, checked_at: new Date('2026-01-01T00:00:00Z') },
        created_at: now,
      },
    ],
  ]);
  saveWordPressConnection.mockImplementation(
    async (id: string, token: string, connectedAt: Date) => {
      const org = orgs.get(id);
      if (!org) return false;
      org.wordpress_token = token;
      org.wordpress_connected_at = connectedAt;
      return true;
    },
  );
  setWordPressPostId.mockImplementation(async (id: string, postId: number) => {
    const article = articles.find((candidate) => candidate.id === id);
    if (!article) return false;
    Object.assign(article, { wordpress_post_id: postId });
    return true;
  });
  return {
    UserRepo: {
      upsertByGoogleSub: vi.fn(async (input: { google_sub: string; email: string }) => ({
        id: 'user_1',
        google_sub: input.google_sub,
        email: input.email,
        created_at: now,
      })),
    },
    OrgRepo: {
      findById: vi.fn(async (id: string) => orgs.get(id) ?? null),
      saveWordPressConnection,
      clearWordPressConnection: vi.fn(async (id: string) => {
        const org = orgs.get(id);
        if (!org) return false;
        org.wordpress_token = undefined;
        org.wordpress_connected_at = undefined;
        return true;
      }),
      updatePresets: vi.fn(async (id: string, presets: unknown) => {
        const o = orgs.get(id);
        if (o) o.presets = presets;
      }),
      updateDomainRating: vi.fn(async (id: string, value: number) => {
        const o = orgs.get(id);
        if (o) o.domain_rating = { value, checked_at: new Date() };
      }),
    },
    KeywordRepo: {
      listByOrg: vi.fn(async (orgId: string) =>
        keywords
          .filter((k) => k.org_id === orgId)
          .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)),
      ),
      countScheduled: vi.fn(
        async (orgId: string) =>
          keywords.filter((k) => k.org_id === orgId && k.status === 'scheduled').length,
      ),
    },
    ArticleRepo: {
      listByOrg: vi.fn(
        async (orgId: string, opts: { status?: string; limit: number; offset: number }) => {
          let rows = articles.filter((a) => a.org_id === orgId);
          if (opts.status) rows = rows.filter((a) => a.status === opts.status);
          return {
            articles: rows.slice(opts.offset, opts.offset + opts.limit),
            total: rows.length,
          };
        },
      ),
      findById: vi.fn(async (id: string) => articles.find((a) => a.id === id) ?? null),
      countByStatus: vi.fn(
        async (orgId: string, status: string) =>
          articles.filter((a) => a.org_id === orgId && a.status === status).length,
      ),
      setWordPressPostId,
      listPublishedTo: vi.fn(async (orgId: string, provider: string) =>
        articles.filter((a) => {
          const rows = (a as { publications?: { provider: string }[] }).publications ?? [];
          return (
            a.org_id === orgId &&
            a.status !== 'deleted' &&
            rows.some((p) => p.provider === provider)
          );
        }),
      ),
      recordPublication: vi.fn(
        async (
          id: string,
          entry: { provider: string; ref: string; slug: string; remote_url?: string | null },
          options?: { publishedAt?: Date; updatedAt?: Date | null },
        ) => {
          const found = articles.find((a) => a.id === id) as
            | { publications?: Record<string, unknown>[] }
            | undefined;
          if (!found) return false;
          if (!found.publications) found.publications = [];
          const existing = found.publications.find((p) => p.provider === entry.provider);
          if (existing) {
            Object.assign(existing, entry, { updated_at: options?.updatedAt ?? new Date() });
          } else {
            found.publications.push({
              ...entry,
              published_at: options?.publishedAt ?? new Date(),
              updated_at: options?.updatedAt ?? null,
            });
          }
          return true;
        },
      ),
      updateContent: vi.fn(async (id: string, patch: Record<string, string>) => {
        const article = articles.find((a) => a.id === id);
        if (!article) return null;
        Object.assign(article, patch, { updated_at: new Date() });
        return article;
      }),
      initializeAutoPublishAttempt: vi.fn(async () => true),
      resetAutoPublishAttempt: vi.fn(async () => true),
      recordAutoPublishPreflightError: vi.fn(async () => {}),
      clearAutoPublishPreflightError: vi.fn(async () => {}),
    },
    IntegrationRepo: {
      listByOrgId: vi.fn(async (orgId: string) =>
        [...integrations.values()].filter((i) => i.org_id === orgId),
      ),
      setError: vi.fn(async (orgId: string, provider: string, code: string | null) => {
        const row = integrations.get(`${orgId}:${provider}`);
        if (row) row.last_error = code === null ? null : { code, at: new Date() };
      }),
      findByOrgAndProvider: vi.fn(
        async (orgId: string, provider: string) => integrations.get(`${orgId}:${provider}`) ?? null,
      ),
      connectWordPress: vi.fn(async (orgId: string, siteUrl: string, tokenEnc: string) => {
        integrations.set(`${orgId}:wordpress`, {
          id: `int_${orgId}_wordpress`,
          org_id: orgId,
          provider: 'wordpress',
          site_url: siteUrl,
          token_enc: tokenEnc,
          connected_at: new Date(),
          last_error: null,
        });
      }),
      claimPublishLease: vi.fn(async () => true),
      releasePublishLease: vi.fn(async () => true),
      deleteByOrgAndProvider: vi.fn(async (orgId: string, provider: string) =>
        integrations.delete(`${orgId}:${provider}`),
      ),
    },
    GscConnectionRepo: {
      findByOrgId: vi.fn(async (orgId: string) => gscConnections.get(orgId) ?? null),
      markRefreshFailed,
    },
  };
});

import { ArticleRepo, IntegrationRepo, OrgRepo } from '@shared/db';
import { testClient } from 'hono/testing';
import { decryptSecret, encryptSecret } from '../src/lib/crypto';
import { logger } from '../src/logger';
import app, { type AppType } from '../src/routes';

const client = testClient<AppType>(app);

beforeEach(async () => {
  editWordPressArticle.mockReset();
  editWordPressArticle.mockResolvedValue({ status: 200, body: { success: true, post_id: 222 } });
  saveWordPressConnection.mockClear();
  setWordPressPostId.mockClear();
  submitWordPressArticle.mockReset();
  submitWordPressArticle.mockResolvedValue({
    status: 200,
    body: { success: true, post_id: 321 },
  });
  testWordPressIntegration.mockReset();
  testWordPressIntegration.mockResolvedValue({ success: true });
  commitFiles.mockReset();
  commitFiles.mockImplementation(async (options) => {
    if (options.prepare) {
      options.files = await options.prepare({
        headCommitSha: 'base',
        readFile: async () => null,
      });
    }
    return 'sha-new';
  });
  enqueuePublishTask.mockReset();
  enqueuePublishTask.mockResolvedValue(undefined);
  // Connections persist across cases like the article fixture does; reset so a
  // test that connects cannot change what the next one reads.
  integrations.clear();
  // The setWordPressPostId/recordPublication mocks persist onto the shared
  // article fixture, so clear the fields create tests mutate to keep each test
  // isolated (the create dup-guard rejects an article that already has a
  // WordPress post ID).
  const seededCreateArticle = (await ArticleRepo.findById('art_1')) as unknown as {
    wordpress_post_id?: number;
    publications?: unknown[];
  } | null;
  if (seededCreateArticle) {
    delete seededCreateArticle.wordpress_post_id;
    // Empty, not absent: the repo parses `publications` through a `.default([])`,
    // so an entity that reached a handler always has the array.
    seededCreateArticle.publications = [];
    delete (seededCreateArticle as { auto_publish?: unknown }).auto_publish;
  }
  const primaryOrg = (await OrgRepo.findById('org_1')) as unknown as {
    plan?: string;
    presets?: { article_preferences: { publishing: { auto_publish: boolean } } };
  } | null;
  if (primaryOrg) {
    primaryOrg.plan = 'free';
    if (primaryOrg.presets) {
      primaryOrg.presets.article_preferences.publishing.auto_publish = false;
    }
  }
  const emptyOrg = (await OrgRepo.findById('org_2')) as unknown as {
    plan?: string;
    presets?: { article_preferences: { publishing: { auto_publish: boolean } } };
  } | null;
  if (emptyOrg) {
    emptyOrg.plan = 'free';
    if (emptyOrg.presets) emptyOrg.presets.article_preferences.publishing.auto_publish = false;
  }
  // Same reason, for the static-site fixtures: publishing writes onto them.
  await resetStaticSiteFixtures();
});

/** Restore the static-site fixtures' publish state to their seeded values. */
async function resetStaticSiteFixtures() {
  const seed: Record<string, Record<string, unknown>[]> = {
    art_7: [],
    art_8: [
      {
        provider: 'static-site',
        ref: 'sha-old',
        slug: 'old-guide',
        published_at: new Date('2026-07-01T00:00:00.000Z'),
        updated_at: null,
      },
    ],
    art_9: [],
  };
  for (const [id, publications] of Object.entries(seed)) {
    const article = (await ArticleRepo.findById(id)) as unknown as {
      slug: string;
      publications: unknown[];
    } | null;
    if (article) article.publications = publications;
  }
}

/** A body that passes every editor rule (meta_description inside 120-160). */
const validArticleUpdate = {
  title: 'Landing Pages, Revised',
  slug: 'landing-pages-revised',
  meta_title: 'Landing Pages Revised',
  meta_description: 'A revised guide to landing pages. '.repeat(4),
  content: '# revised body',
};

async function login(): Promise<string> {
  const res = await client.api.v0.core.login.$post({ json: { id_token: 'fake-google-token' } });
  const { token } = await res.json();
  return token;
}

describe('dashboard home routes', () => {
  test('reject requests without a token', async () => {
    const res = await client.api.v0.dashboard.articles.published.$get({
      query: { org_id: 'org_1' },
    });
    expect(res.status).toBe(401);
  });

  test('GET /articles/published counts published articles for the org', async () => {
    const token = await login();
    const headers = { Authorization: `Bearer ${token}` };
    // org_1 has one published article (art_2); org_2 has none.
    const res = await client.api.v0.dashboard.articles.published.$get(
      { query: { org_id: 'org_1' } },
      { headers },
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).count).toBe(1);

    const empty = await client.api.v0.dashboard.articles.published.$get(
      { query: { org_id: 'org_2' } },
      { headers },
    );
    expect(empty.status).toBe(200);
    if (empty.status === 200) expect((await empty.json()).count).toBe(0);
  });

  test('GET /articles/planned counts scheduled keywords for the org', async () => {
    const token = await login();
    const headers = { Authorization: `Bearer ${token}` };
    // org_1 has two scheduled keywords; org_2 has none.
    const res = await client.api.v0.dashboard.articles.planned.$get(
      { query: { org_id: 'org_1' } },
      { headers },
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).count).toBe(2);

    const empty = await client.api.v0.dashboard.articles.planned.$get(
      { query: { org_id: 'org_2' } },
      { headers },
    );
    expect(empty.status).toBe(200);
    if (empty.status === 200) expect((await empty.json()).count).toBe(0);
  });

  test('GET /articles/published 404s for an org the caller does not own', async () => {
    const token = await login();
    const res = await client.api.v0.dashboard.articles.published.$get(
      { query: { org_id: 'org_3' } },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(404);
  });

  test('GET /articles/best is empty and gated until Google data is connected', async () => {
    const token = await login();
    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const json = await res.json();
      expect(json.articles).toHaveLength(0);
      expect(json.gated).toBe(true);
    }
  });

  test('GET /integrations/connected is empty for a fresh org', async () => {
    const token = await login();
    const res = await client.api.v0.dashboard.integrations.connected.$get(
      { query: { org_id: 'org_2' } },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).integrations).toHaveLength(0);
  });
});

describe('dashboard WordPress integration', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  test('connects an owned org and saves the token only after plugin success', async () => {
    const res = await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id: 'org_1', token: 'secret-token' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(testWordPressIntegration).toHaveBeenCalledWith('https://clewas.com', 'secret-token');
    expect(saveWordPressConnection).toHaveBeenCalledWith('org_1', 'secret-token', expect.any(Date));
    expect(testWordPressIntegration.mock.invocationCallOrder[0]).toBeLessThan(
      saveWordPressConnection.mock.invocationCallOrder[0] ?? 0,
    );
  });

  test.each([
    'org_3',
    'missing-org',
  ])('does not call the plugin for foreign/missing org %s', async (org_id) => {
    const res = await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id, token: 'secret-token' } },
      await auth(),
    );

    expect(res.status).toBe(404);
    expect(testWordPressIntegration).not.toHaveBeenCalled();
    expect(saveWordPressConnection).not.toHaveBeenCalled();
  });

  test.each([
    'invalid_integration_key',
    'integration_not_configured',
  ])('returns plugin error %s without saving the token', async (error_code) => {
    testWordPressIntegration.mockResolvedValueOnce({ success: false, error_code });

    const res = await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id: 'org_1', token: 'rejected-token' } },
      await auth(),
    );

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ success: false, error_code });
    expect(saveWordPressConnection).not.toHaveBeenCalled();
  });

  test('returns a plugin failure without saving the token', async () => {
    testWordPressIntegration.mockResolvedValueOnce({
      success: false,
      error_code: 'post_creation_failed',
    });

    const res = await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id: 'org_1', token: 'plugin-failure-token' } },
      await auth(),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error_code: 'post_creation_failed' });
    expect(saveWordPressConnection).not.toHaveBeenCalled();
  });

  test('returns a network failure without saving the token', async () => {
    testWordPressIntegration.mockRejectedValueOnce(new Error('network down'));

    const res = await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id: 'org_1', token: 'network-failure-token' } },
      await auth(),
    );

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({
      success: false,
      error_code: 'wordpress_request_failed',
    });
    expect(saveWordPressConnection).not.toHaveBeenCalled();
  });

  test('404s when the connection cannot be persisted after a successful test', async () => {
    saveWordPressConnection.mockResolvedValueOnce(false);

    const res = await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id: 'org_1', token: 'secret-token' } },
      await auth(),
    );

    expect(res.status).toBe(404);
    expect(testWordPressIntegration).toHaveBeenCalled();
  });

  test('lists the saved WordPress connection without exposing the token', async () => {
    const opts = await auth();
    await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id: 'org_1', token: 'never-return-this-token' } },
      opts,
    );

    const res = await client.api.v0.dashboard.integrations.connected.$get(
      { query: { org_id: 'org_1' } },
      opts,
    );

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const body = await res.json();
    expect(body.integrations).toEqual([
      {
        id: 'int_org_1_wordpress',
        provider: 'wordpress',
        target: 'https://clewas.com',
        connected_at: expect.any(String),
        last_error: null,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('never-return-this-token');
    expect(body.integrations[0]).not.toHaveProperty('token');
    expect(body.integrations[0]).not.toHaveProperty('wordpress_token');
  });

  test('stores the token encrypted on the integration, never in plaintext', async () => {
    const opts = await auth();
    await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id: 'org_1', token: 'plaintext-wp-token' } },
      opts,
    );

    const stored = integrations.get('org_1:wordpress');
    expect(stored).toMatchObject({ org_id: 'org_1', site_url: 'https://clewas.com' });
    expect(stored?.token_enc).not.toBe('plaintext-wp-token');
    expect(decryptSecret(stored?.token_enc as string, gscKey)).toBe('plaintext-wp-token');
  });

  test('falls back to the org mirror for an operator-made connection', async () => {
    // org_1 carries wordpress_token from the fixture with no integration row —
    // exactly the state the admin connect lever leaves behind.
    const res = await client.api.v0.dashboard.integrations.connected.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect((await res.json()).integrations).toEqual([
      {
        id: 'wordpress',
        provider: 'wordpress',
        target: 'https://clewas.com',
        connected_at: expect.any(String),
        last_error: null,
      },
    ]);
  });

  test('DELETE disconnects, clearing both the integration and the mirror', async () => {
    const opts = await auth();
    await client.api.v0.dashboard.integrations.wordpress.$post(
      { json: { org_id: 'org_2', token: 'to-be-removed' } },
      opts,
    );

    const res = await client.api.v0.dashboard.integrations[':provider'].$delete(
      { param: { provider: 'wordpress' }, query: { org_id: 'org_2' } },
      opts,
    );

    expect(res.status).toBe(204);
    expect(integrations.has('org_2:wordpress')).toBe(false);
    // Without clearing the mirror the fallback above would resurrect it.
    const after = await client.api.v0.dashboard.integrations.connected.$get(
      { query: { org_id: 'org_2' } },
      opts,
    );
    expect(after.status).toBe(200);
    if (after.status !== 200) return;
    expect((await after.json()).integrations).toEqual([]);
  });

  test('DELETE 404s for a foreign org', async () => {
    const res = await client.api.v0.dashboard.integrations[':provider'].$delete(
      { param: { provider: 'wordpress' }, query: { org_id: 'org_3' } },
      await auth(),
    );

    expect(res.status).toBe(404);
  });

  test.each([
    'org_3',
    'missing-org',
  ])('GET /integrations/connected 404s for foreign/missing org %s', async (org_id) => {
    const res = await client.api.v0.dashboard.integrations.connected.$get(
      { query: { org_id } },
      await auth(),
    );
    expect(res.status).toBe(404);
  });
});

describe('dashboard WordPress article routes', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  test('requires authentication', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post({
      param: { id: 'art_1' },
    });

    expect(res.status).toBe(401);
    expect(submitWordPressArticle).not.toHaveBeenCalled();
  });

  test('creates an owned image-complete article and persists only the returned post ID', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id: 'art_1' } },
      opts,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, post_id: 321 });
    expect(submitWordPressArticle).toHaveBeenCalledWith(
      'https://clewas.com',
      expect.any(String),
      expect.objectContaining({ id: 'art_1', status: 'generated', published_at: null }),
    );
    expect(setWordPressPostId).toHaveBeenCalledWith('art_1', 321);

    const article = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'art_1' } },
      opts,
    );
    expect(article.status).toBe(200);
    if (article.status === 200) {
      expect(await article.json()).toMatchObject({
        status: 'generated',
        published_at: null,
        wordpress_post_id: 321,
      });
    }
  });

  test('records the publish in publications[] alongside the deprecated mirror', async () => {
    const opts = await auth();
    await client.api.v0.dashboard.articles[':id'].wordpress.$post({ param: { id: 'art_1' } }, opts);

    const article = (await ArticleRepo.findById('art_1')) as unknown as {
      publications?: Record<string, unknown>[];
    };
    expect(article.publications).toEqual([
      {
        provider: 'wordpress',
        // The WordPress post id as a string — one `ref` shape across providers.
        ref: '321',
        slug: 'landing-pages',
        remote_url: null,
        published_at: expect.any(Date),
        updated_at: null,
      },
    ]);

    // A re-publish stamps updated_at instead of pushing a second entry.
    await client.api.v0.dashboard.articles[':id'].wordpress.$put({ param: { id: 'art_1' } }, opts);
    expect(article.publications).toHaveLength(1);
    expect(article.publications?.[0]).toMatchObject({ updated_at: expect.any(Date) });
  });

  test('stores null rather than an invalid manual WordPress permalink', async () => {
    submitWordPressArticle.mockResolvedValueOnce({
      status: 200,
      body: {
        success: true,
        post_id: 321,
        slug: 'landing-pages',
        permalink: 'not-an-http-url',
        post_status: 'draft',
      },
    });

    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id: 'art_1' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    const stored = (await ArticleRepo.findById('art_1')) as unknown as {
      publications: Array<{ provider: string; remote_url: string | null }>;
    };
    expect(
      stored.publications.find((entry) => entry.provider === 'wordpress')?.remote_url,
    ).toBeNull();
  });

  test('rejects create until article images are complete', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id: 'art_5' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Article images are not complete' });
    expect(submitWordPressArticle).not.toHaveBeenCalled();
    expect(setWordPressPostId).not.toHaveBeenCalled();
  });

  test('rejects create when the article org has no WordPress connection', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id: 'art_4' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'WordPress is not connected' });
    expect(submitWordPressArticle).not.toHaveBeenCalled();
  });

  test('rejects create when the article already has a WordPress post ID', async () => {
    // art_2 already carries wordpress_post_id 222 — a retry must not remap it.
    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id: 'art_2' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Article is already published to WordPress' });
    expect(submitWordPressArticle).not.toHaveBeenCalled();
    expect(setWordPressPostId).not.toHaveBeenCalled();
  });

  test('reports a 500 when the created post ID cannot be persisted', async () => {
    setWordPressPostId.mockResolvedValueOnce(false);

    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id: 'art_1' } },
      await auth(),
    );

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'WordPress post created but its ID could not be saved',
    });
    expect(submitWordPressArticle).toHaveBeenCalled();
  });

  test.each([
    'art_3',
    'missing-article',
  ])('does not submit a foreign or missing article %s', async (id) => {
    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id } },
      await auth(),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Article not found' });
    expect(submitWordPressArticle).not.toHaveBeenCalled();
  });

  test.each([
    [400, 'WordPress rejected the article payload.'],
    [403, 'WordPress rejected the integration credentials. Reconnect the site.'],
    [409, 'WordPress already has another post using this slug.'],
    [500, 'WordPress could not publish the article. Retry shortly.'],
  ] as const)('normalizes a plugin %s create response without persisting', async (status, message) => {
    submitWordPressArticle.mockResolvedValueOnce({
      status,
      body: { error: `plugin-${status}` },
    });

    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id: 'art_1' } },
      await auth(),
    );

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
    expect(setWordPressPostId).not.toHaveBeenCalled();
  });

  test('requires a stored WordPress post ID before update', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$put(
      { param: { id: 'art_5' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Article has not been submitted to WordPress' });
    expect(editWordPressArticle).not.toHaveBeenCalled();
  });

  test('rejects update until article images are complete', async () => {
    // art_6 has a stored post ID but images regressed to pending.
    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$put(
      { param: { id: 'art_6' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Article images are not complete' });
    expect(editWordPressArticle).not.toHaveBeenCalled();
  });

  test('updates by stored WordPress ID and passes warnings through without changing status', async () => {
    editWordPressArticle.mockResolvedValueOnce({
      status: 200,
      body: {
        success: true,
        post_id: 222,
        warnings: ['Featured image could not be assigned.'],
      },
    });
    const opts = await auth();

    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$put(
      { param: { id: 'art_2' } },
      opts,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      post_id: 222,
      warnings: ['Featured image could not be assigned.'],
    });
    expect(editWordPressArticle).toHaveBeenCalledWith(
      'https://clewas.com',
      expect.any(String),
      222,
      expect.objectContaining({ id: 'art_2', status: 'published' }),
    );
    expect(setWordPressPostId).not.toHaveBeenCalled();

    const article = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'art_2' } },
      opts,
    );
    expect(article.status).toBe(200);
    if (article.status === 200) {
      expect(await article.json()).toMatchObject({
        status: 'published',
        wordpress_post_id: 222,
      });
    }
  });

  test('maps a missing remote post on update to an accurate 404', async () => {
    vi.mocked(ArticleRepo.recordPublication).mockClear();
    editWordPressArticle.mockResolvedValueOnce({
      status: 404,
      body: { error: 'Post not found' },
    });

    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$put(
      { param: { id: 'art_2' } },
      await auth(),
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'The WordPress post no longer exists.' });
    expect(ArticleRepo.recordPublication).not.toHaveBeenCalled();
  });
});

describe('POST /dashboard/articles/{id}/auto-publish/retry', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  async function enable(orgId: 'org_1' | 'org_2') {
    const org = (await OrgRepo.findById(orgId)) as unknown as {
      plan: string;
      presets: { article_preferences: { publishing: { auto_publish: boolean } } };
    };
    org.plan = 'paid';
    org.presets.article_preferences.publishing.auto_publish = true;
  }

  test('enforces authentication, ownership, and image readiness', async () => {
    const unauthenticated = await client.api.v0.dashboard.articles[':id'][
      'auto-publish'
    ].retry.$post({ param: { id: 'art_1' } });
    expect(unauthenticated.status).toBe(401);

    const opts = await auth();
    const foreign = await client.api.v0.dashboard.articles[':id']['auto-publish'].retry.$post(
      { param: { id: 'art_3' } },
      opts,
    );
    expect(foreign.status).toBe(404);

    const pending = await client.api.v0.dashboard.articles[':id']['auto-publish'].retry.$post(
      { param: { id: 'art_5' } },
      opts,
    );
    expect(pending.status).toBe(409);
    if (pending.status === 409) expect((await pending.json()).code).toBe('images_incomplete');
    expect(enqueuePublishTask).not.toHaveBeenCalled();
  });

  test('does not queue while automatic publishing is disabled', async () => {
    const res = await client.api.v0.dashboard.articles[':id']['auto-publish'].retry.$post(
      { param: { id: 'art_1' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    if (res.status === 409) expect((await res.json()).code).toBe('auto_publish_disabled');
    expect(enqueuePublishTask).not.toHaveBeenCalled();
  });

  test('persists actionable preflight state when no destination is connected', async () => {
    await enable('org_2');

    const res = await client.api.v0.dashboard.articles[':id']['auto-publish'].retry.$post(
      { param: { id: 'art_4' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    if (res.status === 409) expect((await res.json()).code).toBe('not_connected');
    expect(ArticleRepo.recordAutoPublishPreflightError).toHaveBeenCalledWith(
      'art_4',
      expect.objectContaining({ code: 'not_connected', kind: 'permanent' }),
    );
    expect(enqueuePublishTask).not.toHaveBeenCalled();
  });

  test('resets failed targets and queues every connected unpublished provider', async () => {
    await enable('org_1');
    integrations.set('org_1:static-site', {
      id: 'int_static',
      org_id: 'org_1',
      provider: 'static-site',
      host: 'github',
      installation_id: 4242,
      repo: 'client/site',
      branch: 'main',
      content_path: 'seopotion/',
      connected_at: new Date(),
      last_error: null,
    });
    const target = (await ArticleRepo.findById('art_1')) as unknown as {
      auto_publish: Record<string, unknown>;
    };
    target.auto_publish = {
      preflight_error: null,
      attempts: [
        {
          provider: 'wordpress',
          status: 'failed',
          attempt_count: 3,
          requested_at: new Date(),
          last_attempt_at: new Date(),
          lease_expires_at: null,
          last_error: {
            code: 'network_error',
            kind: 'transient',
            message: 'WordPress could not be reached.',
            at: new Date(),
          },
        },
      ],
    };

    const res = await client.api.v0.dashboard.articles[':id']['auto-publish'].retry.$post(
      { param: { id: 'art_1' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    if (res.status === 200) {
      expect(new Set((await res.json()).queued)).toEqual(new Set(['wordpress', 'static-site']));
    }
    expect(ArticleRepo.resetAutoPublishAttempt).toHaveBeenCalledWith(
      'art_1',
      'wordpress',
      expect.any(Date),
    );
    expect(ArticleRepo.initializeAutoPublishAttempt).toHaveBeenCalledWith(
      'art_1',
      'static-site',
      expect.any(Date),
    );
    expect(enqueuePublishTask).toHaveBeenCalledWith({
      org_id: 'org_1',
      article_id: 'art_1',
      provider: 'wordpress',
    });
    expect(enqueuePublishTask).toHaveBeenCalledWith({
      org_id: 'org_1',
      article_id: 'art_1',
      provider: 'static-site',
    });
  });

  test('never queues a provider already recorded in publications', async () => {
    await enable('org_1');
    integrations.set('org_1:wordpress', {
      id: 'int_wordpress',
      org_id: 'org_1',
      provider: 'wordpress',
      site_url: 'https://clewas.com',
      token_enc: 'encrypted',
      connected_at: new Date(),
      last_error: null,
    });

    const res = await client.api.v0.dashboard.articles[':id']['auto-publish'].retry.$post(
      { param: { id: 'art_2' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).queued).toEqual([]);
    expect(enqueuePublishTask).not.toHaveBeenCalled();
  });

  test('surfaces queue failure so a caller can retry safely', async () => {
    await enable('org_1');
    enqueuePublishTask.mockRejectedValueOnce(new Error('SQS unavailable'));

    const res = await client.api.v0.dashboard.articles[':id']['auto-publish'].retry.$post(
      { param: { id: 'art_1' } },
      await auth(),
    );

    expect(res.status).toBe(502);
    if (res.status === 502) expect((await res.json()).code).toBe('queue_send_failed');
  });
});

describe('POST /dashboard/articles/{id}/publish (static site)', () => {
  // The repo mocks are module-scoped and the suite has no global clearMocks, so
  // the WordPress cases above would otherwise leave calls on this one.
  beforeEach(() => {
    vi.mocked(ArticleRepo.recordPublication).mockClear();
    vi.mocked(IntegrationRepo.claimPublishLease).mockClear();
    vi.mocked(IntegrationRepo.releasePublishLease).mockClear();
  });

  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  function connectStaticSite(over: Record<string, unknown> = {}) {
    integrations.set('org_1:static-site', {
      id: 'int_static',
      org_id: 'org_1',
      provider: 'static-site',
      host: 'github',
      installation_id: 4242,
      repo: 'client/site',
      branch: 'main',
      content_path: 'seopotion/',
      connected_at: new Date(),
      last_error: null,
      ...over,
    });
  }

  /** The single commitFiles call, as `{ path: content }`. */
  function committed() {
    const [opts] = commitFiles.mock.calls[0] as [
      { files: { path: string; content: string | null }[]; message: string; branch: string },
    ];
    return {
      ...opts,
      byPath: Object.fromEntries(opts.files.map((f) => [f.path, f.content])),
    };
  }

  test('requires authentication', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post({
      param: { id: 'art_7' },
    });

    expect(res.status).toBe(401);
    expect(commitFiles).not.toHaveBeenCalled();
  });

  test("404s on another user's article without revealing it exists", async () => {
    connectStaticSite();
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_3' } },
      await auth(),
    );

    expect(res.status).toBe(404);
    expect(commitFiles).not.toHaveBeenCalled();
  });

  test('409s when no static site is connected', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    if (res.status === 409) expect((await res.json()).code).toBe('not_connected');
    expect(commitFiles).not.toHaveBeenCalled();
  });

  test('409s while images are still generating', async () => {
    connectStaticSite();
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_5' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    if (res.status === 409) expect((await res.json()).code).toBe('images_incomplete');
    expect(commitFiles).not.toHaveBeenCalled();
  });

  test('commits the Markdown and the rebuilt manifest in one commit', async () => {
    connectStaticSite();
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    if (res.status === 200) {
      expect(await res.json()).toEqual({
        commit_sha: 'sha-new',
        commit_url: 'https://github.com/client/site/commit/sha-new',
        path: 'seopotion/articles/never-published.md',
      });
    }

    expect(commitFiles).toHaveBeenCalledTimes(1);
    expect(IntegrationRepo.claimPublishLease).toHaveBeenCalledOnce();
    expect(IntegrationRepo.releasePublishLease).toHaveBeenCalledOnce();
    const commit = committed();
    expect(commit.branch).toBe('main');
    expect(commit.message).toBe('seopotion: publish "Never Published"');
    expect(Object.keys(commit.byPath).sort()).toEqual([
      'seopotion/articles/never-published.md',
      'seopotion/manifest.json',
    ]);

    const markdown = commit.byPath['seopotion/articles/never-published.md'] as string;
    expect(markdown).toContain('slug: "never-published"');
    expect(markdown).toContain('cover_alt: "Cover alt"');
    expect(markdown.endsWith('## Section\n\nBody.\n')).toBe(true);

    // The manifest is rebuilt from everything live, not patched: art_8 was
    // already published and must survive art_7's commit.
    const manifest = JSON.parse(commit.byPath['seopotion/manifest.json'] as string);
    expect(manifest.version).toBe(1);
    expect(manifest.articles.map((a: { slug: string }) => a.slug).sort()).toEqual([
      'never-published',
      'old-guide',
    ]);
  });

  test('records the commit sha and the slug it published under', async () => {
    connectStaticSite();
    await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(ArticleRepo.recordPublication).toHaveBeenCalledWith(
      'art_7',
      {
        provider: 'static-site',
        ref: 'sha-new',
        slug: 'never-published',
        remote_url: 'https://github.com/client/site/commit/sha-new',
      },
      { publishedAt: expect.any(Date), updatedAt: null },
    );
  });

  test('writes the same timestamp into the manifest that it stores', async () => {
    connectStaticSite();
    await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    const manifest = JSON.parse(committed().byPath['seopotion/manifest.json'] as string);
    const entry = manifest.articles.find((a: { slug: string }) => a.slug === 'never-published');
    const storedAt = vi.mocked(ArticleRepo.recordPublication).mock.calls[0]![2]
      ?.publishedAt as Date;

    // Otherwise the next rebuild of this file — triggered by a different
    // article — produces a millisecond-wide diff on an untouched entry.
    expect(entry.published_at).toBe(storedAt.toISOString());
  });

  test('deletes the old file in the same commit when the slug was renamed', async () => {
    connectStaticSite();
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_8' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    const commit = committed();
    expect(commit.message).toBe('seopotion: update "Renamed Guide"');
    expect(commit.byPath).toEqual({
      'seopotion/articles/renamed-guide.md': expect.any(String),
      'seopotion/manifest.json': expect.any(String),
      // A null content is the tree API's deletion.
      'seopotion/articles/old-guide.md': null,
    });

    // `published_at` keeps meaning "first went live"; the republish stamps updated_at.
    const markdown = commit.byPath['seopotion/articles/renamed-guide.md'] as string;
    expect(markdown).toContain('published_at: "2026-07-01T00:00:00.000Z"');
    expect(markdown).not.toContain('updated_at: null');
  });

  test('409s rather than overwriting another article published at the same slug', async () => {
    connectStaticSite();
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_9' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    if (res.status === 409) {
      const body = await res.json();
      expect(body.code).toBe('slug_conflict');
      expect(body.error).toContain('old-guide');
    }
    expect(commitFiles).toHaveBeenCalledOnce();
    expect(ArticleRepo.recordPublication).not.toHaveBeenCalled();
  });

  test('honours a custom content_path', async () => {
    connectStaticSite({ content_path: 'src/content' });
    await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(Object.keys(committed().byPath).sort()).toEqual([
      'src/content/articles/never-published.md',
      'src/content/manifest.json',
    ]);
  });

  test('422s when GitHub refuses the commit', async () => {
    connectStaticSite();
    commitFiles.mockRejectedValue(new GithubError('commit_rejected', 'Branch is protected'));
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(res.status).toBe(422);
    if (res.status === 422) {
      expect(await res.json()).toEqual({
        error: 'GitHub rejected the commit. Check branch protection and repository access.',
        code: 'commit_rejected',
      });
    }
    expect(ArticleRepo.recordPublication).not.toHaveBeenCalled();
  });

  test('409s when the branch moved under us — the caller retries', async () => {
    connectStaticSite();
    commitFiles.mockRejectedValue(new GithubError('ref_conflict', 'Ref moved'));
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(res.status).toBe(409);
    if (res.status === 409) expect((await res.json()).code).toBe('ref_conflict');
  });

  test('502s when GitHub could not be reached', async () => {
    connectStaticSite();
    commitFiles.mockRejectedValue(new Error('socket hang up'));
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(res.status).toBe(502);
    if (res.status === 502) expect((await res.json()).code).toBe('github_request_failed');
  });

  test('500s when the commit landed but the publish state could not be saved', async () => {
    connectStaticSite();
    vi.mocked(ArticleRepo.recordPublication).mockResolvedValueOnce(false);
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(res.status).toBe(500);
    if (res.status === 500) expect((await res.json()).code).toBe('record_failed');
  });

  // Webhooks are inactive in v1, so a failed publish is the only way the
  // settings panel ever learns an installation has died.
  test('sticks a permanent GitHub refusal on the connection', async () => {
    connectStaticSite();
    commitFiles.mockRejectedValue(new GithubError('installation_not_found', 'Gone'));
    await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(integrations.get('org_1:static-site')?.last_error).toMatchObject({
      code: 'installation_not_found',
    });
  });

  test.each([
    ['ref_conflict', 'a lost push race'],
    ['github_request_failed', 'an unreachable GitHub'],
  ])('does not record %s — %s is transient', async (code) => {
    connectStaticSite();
    commitFiles.mockRejectedValue(new GithubError(code, 'boom'));
    await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(integrations.get('org_1:static-site')?.last_error).toBeNull();
  });

  test('a successful publish clears a standing failure', async () => {
    connectStaticSite({ last_error: { code: 'repo_not_found', at: new Date() } });
    const res = await client.api.v0.dashboard.articles[':id'].publish.$post(
      { param: { id: 'art_7' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    expect(integrations.get('org_1:static-site')?.last_error).toBeNull();
  });

  test('GET /integrations/connected surfaces the standing failure', async () => {
    connectStaticSite({ last_error: { code: 'missing_write_permission', at: new Date() } });
    const res = await client.api.v0.dashboard.integrations.connected.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    if (res.status === 200) {
      const row = (await res.json()).integrations.find((i) => i.provider === 'static-site');
      expect(row?.last_error?.code).toBe('missing_write_permission');
    }
  });
});

describe('dashboard planner / history / settings routes (mock data)', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  test('reject requests without a token', async () => {
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(401);
  });

  test('GET /planner returns real scheduled keywords for the org', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'org_1' } }, opts);
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const { keywords, strategy_status } = await res.json();
      expect(keywords.map((k) => k.keyword)).toEqual(['landing pages', 'notion builder']);
      expect(keywords[0]?.article_id).toBe('art_1');
      expect(keywords[1]?.article_id).toBeNull();
      expect(strategy_status).toBe('completed');
      // #99: candidate linkage, classification, and generation state exposed.
      expect(keywords[0]).toMatchObject({
        candidate_id: null,
        article_type: null,
        intent: null,
        opportunity_score: null,
        generation_status: 'generated',
        generation_error: null,
      });
      expect(keywords[1]).toMatchObject({
        candidate_id: 'cand_2',
        article_type: 'how_to_guide',
        intent: 'informational',
        opportunity_score: 0.7,
        generation_status: 'pending',
      });
    }
  });

  test('GET /planner is empty for an org with no keywords', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'org_2' } }, opts);
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.keywords).toHaveLength(0);
      // Org never ran a paid strategy job -> defaults to 'none'.
      expect(body.strategy_status).toBe('none');
    }
  });

  test('GET /planner 404s for an org the caller does not own', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'nope' } }, opts);
    expect(res.status).toBe(404);
  });

  test('GET /articles returns rows + total, filterable by status', async () => {
    const opts = await auth();
    const all = await client.api.v0.dashboard.articles.$get({ query: { org_id: 'org_1' } }, opts);
    expect(all.status).toBe(200);
    if (all.status !== 200) return;
    const allBody = await all.json();
    expect(allBody.total).toBe(allBody.articles.length);
    expect(allBody.articles.length).toBeGreaterThan(1);

    const published = await client.api.v0.dashboard.articles.$get(
      { query: { org_id: 'org_1', status: 'published' } },
      opts,
    );
    expect(published.status).toBe(200);
    if (published.status !== 200) return;
    const pubBody = await published.json();
    expect(pubBody.articles.every((a) => a.status === 'published')).toBe(true);
    expect(pubBody.total).toBeLessThan(allBody.total);
  });

  test('GET /articles includes safe provider publishing state without leases or secrets', async () => {
    const target = (await ArticleRepo.findById('art_1')) as unknown as {
      publications: Record<string, unknown>[];
      auto_publish: Record<string, unknown>;
    };
    const at = new Date('2026-08-12T10:00:00.000Z');
    target.publications = [
      {
        provider: 'wordpress',
        ref: '321',
        slug: 'landing-pages-live',
        remote_url: 'https://clewas.com/landing-pages-live/',
        published_at: at,
        updated_at: null,
      },
    ];
    target.auto_publish = {
      preflight_error: null,
      attempts: [
        {
          provider: 'wordpress',
          status: 'published',
          attempt_count: 1,
          requested_at: at,
          last_attempt_at: at,
          lease_expires_at: null,
          last_error: null,
        },
        {
          provider: 'static-site',
          status: 'retrying',
          attempt_count: 2,
          requested_at: at,
          last_attempt_at: at,
          lease_expires_at: new Date('2026-08-12T10:05:00.000Z'),
          last_error: {
            code: 'github_request_failed',
            kind: 'transient',
            message: 'GitHub could not be reached.',
            at,
          },
        },
      ],
    };

    const res = await client.api.v0.dashboard.articles.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const row = (await res.json()).articles.find((entry) => entry.id === 'art_1');
    expect(row?.publications).toEqual([
      expect.objectContaining({
        provider: 'wordpress',
        ref: '321',
        slug: 'landing-pages-live',
        remote_url: 'https://clewas.com/landing-pages-live/',
        published_at: at.toISOString(),
      }),
    ]);
    expect(row?.auto_publish_error).toBeNull();
    expect(row?.auto_publish_attempts).toEqual([
      expect.objectContaining({ provider: 'wordpress', status: 'published', attempt_count: 1 }),
      expect.objectContaining({
        provider: 'static-site',
        status: 'retrying',
        attempt_count: 2,
        last_error: expect.objectContaining({ code: 'github_request_failed' }),
      }),
    ]);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain('lease_expires_at');
    expect(serialized).not.toContain('wordpress_token');
    expect(serialized).not.toContain('token_enc');
  });

  test('GET /articles 404s for an org the caller does not own', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.articles.$get({ query: { org_id: 'org_3' } }, opts);
    expect(res.status).toBe(404);
  });

  test('GET /articles/:id returns the owned article, 404 otherwise', async () => {
    const opts = await auth();
    const ok = await client.api.v0.dashboard.articles[':id'].$get({ param: { id: 'art_1' } }, opts);
    expect(ok.status).toBe(200);
    if (ok.status === 200) {
      const body = await ok.json();
      expect(body.id).toBe('art_1');
      // Date entity fields are serialized to ISO strings in the response.
      expect(typeof body.created_at).toBe('string');
      expect(body.video).toEqual({
        video_id: 'v1',
        title: 'Widget basics',
        section_heading: 'Intro',
      });
    }

    const missing = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'nope' } },
      opts,
    );
    expect(missing.status).toBe(404);

    // art_3 belongs to another user's org — must 404, not leak the record.
    const foreign = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'art_3' } },
      opts,
    );
    expect(foreign.status).toBe(404);
  });

  test('GET /articles/:id exposes the editor fields', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'art_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.meta_title).toBe('Landing Pages Guide');
      expect(body.keyword).toBe('landing pages');
      expect(body.images_status).toBe('complete');
      // Never edited since generation.
      expect(body.updated_at).toBeNull();
    }
  });

  test('GET /articles/:id exposes safe automatic-publishing state without leases', async () => {
    const target = (await ArticleRepo.findById('art_1')) as unknown as {
      publications: Record<string, unknown>[];
      auto_publish: Record<string, unknown>;
    };
    const at = new Date('2026-08-12T10:00:00.000Z');
    target.publications = [
      {
        provider: 'static-site',
        ref: 'abc123',
        slug: 'landing-pages',
        remote_url: 'https://github.com/client/site/commit/abc123',
        published_at: at,
        updated_at: null,
      },
    ];
    target.auto_publish = {
      preflight_error: {
        code: 'not_connected',
        kind: 'permanent',
        message: 'Connect a publishing destination.',
        at,
      },
      attempts: [
        {
          provider: 'wordpress',
          status: 'retrying',
          attempt_count: 2,
          requested_at: at,
          last_attempt_at: at,
          lease_expires_at: new Date('2026-08-12T10:05:00.000Z'),
          last_error: {
            code: 'network_error',
            kind: 'transient',
            message: 'WordPress could not be reached.',
            at,
          },
        },
      ],
    };

    const res = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'art_1' } },
      await auth(),
    );

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const body = await res.json();
    expect(body.publications[0]).toMatchObject({
      provider: 'static-site',
      ref: 'abc123',
      remote_url: 'https://github.com/client/site/commit/abc123',
    });
    expect(body.auto_publish_error?.code).toBe('not_connected');
    expect(body.auto_publish_attempts[0]).toMatchObject({
      provider: 'wordpress',
      status: 'retrying',
      attempt_count: 2,
      last_error: { code: 'network_error', kind: 'transient' },
    });
    expect(body.auto_publish_attempts[0]).not.toHaveProperty('lease_expires_at');
  });

  test('GET /articles/:id reports the static-site publish state', async () => {
    const opts = await auth();
    const never = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'art_1' } },
      opts,
    );
    expect(never.status).toBe(200);
    if (never.status === 200) {
      expect((await never.json()).static_site_published_at).toBeNull();
    }

    // art_8 was published under a slug it has since been renamed away from —
    // the date is still the first publish, which is what the badge shows.
    const published = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'art_8' } },
      opts,
    );
    expect(published.status).toBe(200);
    if (published.status === 200) {
      expect((await published.json()).static_site_published_at).toBe('2026-07-01T00:00:00.000Z');
    }
  });

  test('PATCH /articles/:id saves the editable fields and stamps updated_at', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].$patch(
      { param: { id: 'art_1' }, json: validArticleUpdate },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body).toMatchObject({
        id: 'art_1',
        title: validArticleUpdate.title,
        slug: validArticleUpdate.slug,
        meta_title: validArticleUpdate.meta_title,
        meta_description: validArticleUpdate.meta_description,
        content: validArticleUpdate.content,
      });
      // Same shape as GET, with the save reflected back as an ISO string.
      expect(typeof body.updated_at).toBe('string');
      expect(body.keyword).toBe('landing pages');
      expect(body.images_status).toBe('complete');
    }
  });

  test('PATCH /articles/:id 400s with per-field messages', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].$patch(
      {
        param: { id: 'art_1' },
        json: {
          ...validArticleUpdate,
          // Whitespace-only must fail like empty — the editor trims too.
          title: '   ',
          meta_title: 'x'.repeat(61),
          meta_description: 'too short',
        },
      },
      await auth(),
    );
    expect(res.status).toBe(400);
    if (res.status === 400) {
      const body = await res.json();
      expect(body.error).toBe('Validation failed');
      expect(Object.keys(body.fields).sort()).toEqual(['meta_description', 'meta_title', 'title']);
      expect(body.fields.meta_title).toContain('60');
      expect(body.fields.meta_description).toContain('120');
    }
  });

  test('PATCH /articles/:id 404s for an unknown id', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].$patch(
      { param: { id: 'nope' }, json: validArticleUpdate },
      await auth(),
    );
    expect(res.status).toBe(404);
  });

  test('PATCH /articles/:id 404s for an article in another org', async () => {
    const res = await client.api.v0.dashboard.articles[':id'].$patch(
      { param: { id: 'art_3' }, json: validArticleUpdate },
      await auth(),
    );
    expect(res.status).toBe(404);
    // The foreign record must be untouched.
    expect(ArticleRepo.updateContent).not.toHaveBeenCalledWith('art_3', expect.anything());
  });

  test('static /articles/best still resolves after adding /articles/:id', async () => {
    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const json = await res.json();
      expect(json.articles).toHaveLength(0);
      expect(json.gated).toBe(true);
    }
  });
});

describe('dashboard settings persistence', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  test('PATCH /settings/articles deep-merges and persists across reads', async () => {
    const opts = await auth();
    const patched = await client.api.v0.dashboard.settings.articles.$patch(
      { json: { org_id: 'org_1', engagement: { image_style: 'Watercolor' } } },
      opts,
    );
    expect(patched.status).toBe(200);
    if (patched.status === 200) {
      expect((await patched.json()).article_preferences.engagement.image_style).toBe('Watercolor');
    }

    // Persistence: a fresh GET reflects the saved change.
    const get = await client.api.v0.dashboard.settings.articles.$get(
      { query: { org_id: 'org_1' } },
      opts,
    );
    expect(get.status).toBe(200);
    if (get.status === 200) {
      const body = await get.json();
      expect(body.article_preferences.engagement.image_style).toBe('Watercolor');
      // Sibling content_seo left untouched by the merge.
      expect(body.article_preferences.content_seo.article_style).toBeTruthy();
    }
  });

  test('PATCH /settings/general deep-merges and persists across reads', async () => {
    const opts = await auth();
    const patched = await client.api.v0.dashboard.settings.general.$patch(
      { json: { org_id: 'org_1', business: { name: 'Renamed Co' } } },
      opts,
    );
    expect(patched.status).toBe(200);
    if (patched.status === 200) {
      expect((await patched.json()).business.name).toBe('Renamed Co');
    }

    const get = await client.api.v0.dashboard.settings.general.$get(
      { query: { org_id: 'org_1' } },
      opts,
    );
    expect(get.status).toBe(200);
    if (get.status === 200) {
      const body = await get.json();
      expect(body.business.name).toBe('Renamed Co');
      // Audience untouched; language sibling preserved.
      expect(body.business.language).toBeTruthy();
      expect(body.audience.competitors.length).toBeGreaterThan(0);
    }
  });

  test('PATCH /settings/general audience target array survives edit + reads', async () => {
    const opts = await auth();
    const patched = await client.api.v0.dashboard.settings.general.$patch(
      { json: { org_id: 'org_1', audience: { target: ['makers', 'founders'] } } },
      opts,
    );
    expect(patched.status).toBe(200);
    if (patched.status === 200) {
      expect((await patched.json()).audience.target).toEqual(['makers', 'founders']);
    }

    const get = await client.api.v0.dashboard.settings.general.$get(
      { query: { org_id: 'org_1' } },
      opts,
    );
    expect(get.status).toBe(200);
    if (get.status === 200) {
      // Still an array (never joined into a string) after persistence.
      expect((await get.json()).audience.target).toEqual(['makers', 'founders']);
    }
  });

  test('settings 404 for an org the caller does not own', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.settings.articles.$get(
      { query: { org_id: 'unknown' } },
      opts,
    );
    expect(res.status).toBe(404);
  });

  test('PATCH /settings/articles updates publishing + content_seo counts', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.settings.articles.$patch(
      {
        json: {
          org_id: 'org_1',
          content_seo: { internal_links_count: 2, table_of_contents: false },
          publishing: { auto_publish: true },
        },
      },
      opts,
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.article_preferences.content_seo.internal_links_count).toBe(2);
      expect(body.article_preferences.content_seo.table_of_contents).toBe(false);
      expect(body.article_preferences.publishing.auto_publish).toBe(true);
    }
  });
});

describe('GSC-gated home cards', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  function connectOrg1() {
    gscConnections.set('org_1', {
      id: 'c1',
      org_id: 'org_1',
      refresh_token_enc: encryptSecret('rt-live', Buffer.alloc(32, 7)),
      site_url: 'sc-domain:clewas.com',
      google_email: 'o@x.com',
      connected_at: new Date(),
      last_refresh_failed_at: null,
    });
  }

  beforeEach(() => {
    gscConnections.clear();
    querySearchAnalytics.mockReset();
    markRefreshFailed.mockClear();
  });

  test('best stays gated without a connection', async () => {
    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.gated).toBe(true);
      expect(body.articles).toHaveLength(0);
    }
  });

  test('best returns top pages with slug-matched titles when connected', async () => {
    connectOrg1();
    querySearchAnalytics.mockResolvedValueOnce([
      {
        keys: ['https://clewas.com/blog/notion-builder'],
        clicks: 41.2,
        impressions: 900,
        ctr: 0.04,
        position: 7,
      },
      {
        keys: ['https://clewas.com/pricing'],
        clicks: 12,
        impressions: 300,
        ctr: 0.04,
        position: 9,
      },
    ]);

    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.gated).toBe(false);
      expect(body.articles).toEqual([
        { url: 'https://clewas.com/blog/notion-builder', clicks: 41, title: 'Notion Builder' },
        { url: 'https://clewas.com/pricing', clicks: 12, title: null },
      ]);
    }
    // The stored token decrypts back to the raw refresh token for the query.
    expect(querySearchAnalytics).toHaveBeenCalledWith(
      'rt-live',
      'sc-domain:clewas.com',
      expect.objectContaining({ dimensions: ['page'], rowLimit: 10 }),
    );
  });

  test('revoked access re-gates and stamps the failure', async () => {
    connectOrg1();
    querySearchAnalytics.mockRejectedValueOnce(new GscAuthRevokedError('revoked'));

    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).gated).toBe(true);
    expect(markRefreshFailed).toHaveBeenCalledWith('org_1');
  });

  test('transient (non-revoked) errors re-gate without stamping and log a warning', async () => {
    connectOrg1();
    querySearchAnalytics.mockRejectedValueOnce(new Error('GSC 503'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).gated).toBe(true);
    expect(markRefreshFailed).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'GSC read failed for /articles/best',
      expect.objectContaining({ org_id: 'org_1', error: expect.any(Error) }),
    );
    warnSpy.mockRestore();
  });

  test('best 404s for an org the caller does not own', async () => {
    const res = await client.api.v0.dashboard.articles.best.$get(
      { query: { org_id: 'org_3' } },
      await auth(),
    );
    expect(res.status).toBe(404);
  });

  test('search-performance is gated without a connection, live with one', async () => {
    const gated = await client.api.v0.dashboard['search-performance'].$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(gated.status).toBe(200);
    if (gated.status === 200) {
      expect(await gated.json()).toEqual({
        gated: true,
        clicks: null,
        impressions: null,
        ctr: null,
        position: null,
      });
    }

    connectOrg1();
    querySearchAnalytics.mockResolvedValueOnce([
      { keys: [], clicks: 120, impressions: 4000, ctr: 0.03, position: 12.4 },
    ]);
    const live = await client.api.v0.dashboard['search-performance'].$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(live.status).toBe(200);
    if (live.status === 200) {
      expect(await live.json()).toEqual({
        gated: false,
        clicks: 120,
        impressions: 4000,
        ctr: 0.03,
        position: 12.4,
      });
    }
  });

  test('search-performance: transient (non-revoked) errors re-gate and log a warning', async () => {
    connectOrg1();
    querySearchAnalytics.mockRejectedValueOnce(new Error('network blip'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    const res = await client.api.v0.dashboard['search-performance'].$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).gated).toBe(true);
    expect(markRefreshFailed).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      'GSC read failed for /search-performance',
      expect.objectContaining({ org_id: 'org_1', error: expect.any(Error) }),
    );
    warnSpy.mockRestore();
  });
});

describe('GET /dashboard/domain-rating', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  beforeEach(() => {
    backlinksSummary.mockClear();
    backlinksSummary.mockResolvedValue({ rank: 730 });
  });

  test('rejects requests without a token', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get({
      query: { org_id: 'org_1' },
    });
    expect(res.status).toBe(401);
  });

  test('returns the stored value without a provider call when fresh', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).rating).toBe(41);
    expect(backlinksSummary).not.toHaveBeenCalled();
  });

  test('re-fetches and persists when stale', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_stale' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).rating).toBe(73);
    expect(backlinksSummary).toHaveBeenCalledWith('stale.com');
  });

  test('falls back to the stale value when the provider fails', async () => {
    backlinksSummary.mockRejectedValueOnce(new Error('down'));
    // org_stale was refreshed by the previous test's mock store write; use a
    // fresh failure path org: org_2 has no rating at all.
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_2' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).rating).toBeNull();
  });

  test('fetches for an org that has no rating yet', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_2' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).rating).toBe(73);
  });

  test('404s for an org the caller does not own', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_3' } },
      await auth(),
    );
    expect(res.status).toBe(404);
  });
});
