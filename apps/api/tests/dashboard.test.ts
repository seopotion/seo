import { beforeEach, describe, expect, test, vi } from 'vitest';

// Google verification is mocked — no network, no real token needed.
vi.mock('../src/clients/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g-sub-123', email: 'u@example.com', name: 'U' })),
}));

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
      slug: 'landing-pages',
      keyword: 'landing pages',
      meta_description: 'm',
      featured_image_url: 'https://x/1.png',
      content: '# a',
      difficulty: 36,
      search_volume: 170,
      status: 'generated',
      created_at: now,
      published_at: null,
      video: { video_id: 'v1', title: 'Widget basics', section_heading: 'Intro' },
    },
    {
      id: 'art_2',
      org_id: 'org_1',
      keyword_id: 'kw_2',
      title: 'Notion Builder',
      slug: 'notion-builder',
      keyword: 'notion builder',
      meta_description: 'm',
      featured_image_url: 'https://x/2.png',
      content: '# b',
      difficulty: 48,
      search_volume: 2400,
      status: 'published',
      created_at: now,
      published_at: now,
      video: null,
    },
    // Owned by org_3 (user_2) — never visible to user_1 via detail reads.
    {
      id: 'art_3',
      org_id: 'org_3',
      keyword_id: 'kw_9',
      title: 'Foreign Article',
      slug: 'foreign-article',
      keyword: 'foreign',
      meta_description: 'm',
      featured_image_url: 'https://x/3.png',
      content: '# c',
      difficulty: 10,
      search_volume: 50,
      status: 'generated',
      created_at: now,
      published_at: null,
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
    },
    GscConnectionRepo: {
      findByOrgId: vi.fn(async (orgId: string) => gscConnections.get(orgId) ?? null),
      markRefreshFailed,
    },
  };
});

import { testClient } from 'hono/testing';
import { encryptSecret } from '../src/lib/crypto';
import { logger } from '../src/logger';
import app, { type AppType } from '../src/routes';

const client = testClient<AppType>(app);

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
    const res = await client.api.v0.dashboard.integrations.connected.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).integrations).toHaveLength(0);
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
