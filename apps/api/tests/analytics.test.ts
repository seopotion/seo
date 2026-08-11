import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Google verification is mocked — no network, no real token needed.
vi.mock('../src/clients/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g-sub-123', email: 'u@example.com', name: 'U' })),
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

const { analyticsCache } = vi.hoisted(() => ({
  analyticsCache: new Map<string, unknown[]>(),
}));

vi.mock('@shared/db', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const articles = [
    {
      id: 'art_pub',
      org_id: 'org_1',
      keyword_id: 'kw_pub',
      title: 'Landing Pages',
      meta_title: 'Landing Pages',
      slug: 'landing-pages',
      keyword: 'landing pages',
      meta_description: 'm',
      featured_image_url: 'https://x/pub.png',
      content: '# a',
      difficulty: 30,
      search_volume: 100,
      status: 'published',
      images_status: 'complete',
      created_at: now,
      updated_at: null,
      published_at: new Date('2026-06-01T00:00:00Z'),
      publications: [
        {
          provider: 'static-site',
          ref: 'sha1',
          slug: 'landing-pages',
          published_at: new Date('2026-06-01T00:00:00Z'),
          updated_at: null,
        },
      ],
      video: null,
    },
    {
      id: 'art_new',
      org_id: 'org_1',
      keyword_id: 'kw_new',
      title: 'Fresh Post',
      meta_title: 'Fresh Post',
      slug: 'fresh-post',
      keyword: 'fresh post',
      meta_description: 'm',
      featured_image_url: 'https://x/new.png',
      content: '# b',
      difficulty: 20,
      search_volume: 50,
      status: 'published',
      images_status: 'complete',
      created_at: now,
      updated_at: null,
      // 2 days before the fixed "now" used by the /summary tests below.
      published_at: new Date('2026-08-09T12:00:00Z'),
      publications: [
        {
          provider: 'static-site',
          ref: 'sha2',
          slug: 'fresh-post',
          published_at: new Date('2026-08-09T12:00:00Z'),
          updated_at: null,
        },
      ],
      video: null,
    },
    {
      id: 'art_mid',
      org_id: 'org_1',
      keyword_id: 'kw_mid',
      title: 'Mid Post',
      meta_title: 'Mid Post',
      slug: 'mid-post',
      keyword: 'mid post',
      meta_description: 'm',
      featured_image_url: 'https://x/mid.png',
      content: '# c',
      difficulty: 25,
      search_volume: 75,
      status: 'published',
      images_status: 'complete',
      created_at: now,
      updated_at: null,
      // 10 days before the fixed "now" used by the /summary and /articles tests.
      published_at: new Date('2026-08-01T12:00:00Z'),
      publications: [
        {
          provider: 'static-site',
          ref: 'sha3',
          slug: 'mid-post',
          published_at: new Date('2026-08-01T12:00:00Z'),
          updated_at: null,
        },
      ],
      video: null,
    },
  ];
  const orgs = new Map<string, Record<string, unknown>>([
    [
      'org_1',
      {
        id: 'org_1',
        user_id: 'user_1',
        website_url: 'https://site.com',
        setup_status: 'setup_complete',
        created_at: now,
      },
    ],
    // Owned by a different user — proves ownership 404s don't leak.
    [
      'org_3',
      { id: 'org_3', user_id: 'user_2', website_url: 'https://other.com', created_at: now },
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
    },
    GscConnectionRepo: {
      findByOrgId: vi.fn(async (orgId: string) => gscConnections.get(orgId) ?? null),
      markRefreshFailed,
    },
    GscAnalyticsCacheRepo: {
      get: vi.fn(async (key: string) => analyticsCache.get(key) ?? null),
      put: vi.fn(async (key: string, _orgId: string, rows: unknown[]) => {
        analyticsCache.set(key, rows);
      }),
    },
  };
});

import { testClient } from 'hono/testing';
import { encryptSecret } from '../src/lib/crypto';
import app, { type AppType } from '../src/routes';

const client = testClient<AppType>(app);

/** Connects org `orgId` to GSC with a real-encrypted fixture refresh token. */
function connectGsc(orgId: string, siteUrl: string) {
  gscConnections.set(orgId, {
    id: `gsc_${orgId}`,
    org_id: orgId,
    refresh_token_enc: encryptSecret('fake-refresh-token', gscKey),
    site_url: siteUrl,
    google_email: 'a@example.com',
    connected_at: new Date(),
    last_refresh_failed_at: null,
  });
}

async function login(): Promise<string> {
  const res = await client.api.v0.core.login.$post({ json: { id_token: 'fake-google-token' } });
  const { token } = await res.json();
  return token;
}

async function auth() {
  const token = await login();
  return { headers: { Authorization: `Bearer ${token}` } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-11T12:00:00Z'));
  gscConnections.clear();
  analyticsCache.clear();
  querySearchAnalytics.mockReset();
  markRefreshFailed.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /dashboard/analytics/summary', () => {
  test('401 without a token', async () => {
    const res = await client.api.v0.dashboard.analytics.summary.$get({
      query: { org_id: 'org_1' },
    });
    expect(res.status).toBe(401);
  });

  test('404 for an org the caller does not own', async () => {
    const res = await client.api.v0.dashboard.analytics.summary.$get(
      { query: { org_id: 'org_3' } },
      await auth(),
    );
    expect(res.status).toBe(404);
  });

  test('gated shape when GSC is not connected', async () => {
    const res = await client.api.v0.dashboard.analytics.summary.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(await res.json()).toEqual({
      gated: true,
      totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
      deltas: { clicks: null, impressions: null, ctr: null, position: null },
      series: [],
    });
    expect(querySearchAnalytics).not.toHaveBeenCalled();
  });

  test('site scope: one date-dimension call over the 2x window, split server-side', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics.mockResolvedValueOnce([
      { keys: ['2026-07-01'], clicks: 100, impressions: 1000, ctr: 0.1, position: 8 },
      { keys: ['2026-08-05'], clicks: 120, impressions: 2000, ctr: 0.06, position: 5 },
    ]);
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.summary.$get(
      { query: { org_id: 'org_1', range: '30d', scope: 'site' } },
      opts,
    );

    expect(res.status).toBe(200);
    expect(querySearchAnalytics).toHaveBeenCalledTimes(1);
    expect(querySearchAnalytics).toHaveBeenCalledWith('fake-refresh-token', 'https://site.com', {
      startDate: '2026-06-10',
      endDate: '2026-08-08',
      dimensions: ['date'],
    });
    if (res.status !== 200) return;
    const body = await res.json();
    expect(body.gated).toBe(false);
    expect(body.totals).toEqual({ clicks: 120, impressions: 2000, ctr: 0.06, position: 5 });
    expect(body.deltas.clicks).toBeCloseTo(0.2);
    expect(body.deltas.impressions).toBe(1);
    expect(body.deltas.ctr).toBeCloseTo(-0.4);
    expect(body.deltas.position).toBe(-3);
    expect(body.series).toEqual([
      { date: '2026-08-05', clicks: 120, impressions: 2000, ctr: 0.06, position: 5 },
    ]);
  });

  test('articles scope: date+page dimensions with rowLimit 25000, only matched pages count', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics.mockResolvedValueOnce([
      {
        keys: ['2026-08-05', 'https://site.com/blog/landing-pages'],
        clicks: 7,
        impressions: 100,
        ctr: 0.07,
        position: 3,
      },
      {
        keys: ['2026-08-05', 'https://site.com/pricing'],
        clicks: 50,
        impressions: 500,
        ctr: 0.1,
        position: 1,
      },
    ]);
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.summary.$get(
      { query: { org_id: 'org_1', range: '30d', scope: 'articles' } },
      opts,
    );

    expect(res.status).toBe(200);
    expect(querySearchAnalytics).toHaveBeenCalledWith('fake-refresh-token', 'https://site.com', {
      startDate: '2026-06-10',
      endDate: '2026-08-08',
      dimensions: ['date', 'page'],
      rowLimit: 25000,
    });
    if (res.status !== 200) return;
    const body = await res.json();
    expect(body.totals.clicks).toBe(7);
    expect(body.series).toEqual([
      { date: '2026-08-05', clicks: 7, impressions: 100, ctr: 0.07, position: 3 },
    ]);
  });

  test('a second identical request is served from the cache (one live GSC call total)', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics.mockResolvedValueOnce([
      { keys: ['2026-08-05'], clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
    ]);
    const opts = await auth();
    const query = { org_id: 'org_1', range: '30d' as const, scope: 'site' as const };

    const first = await client.api.v0.dashboard.analytics.summary.$get({ query }, opts);
    expect(first.status).toBe(200);
    const second = await client.api.v0.dashboard.analytics.summary.$get({ query }, opts);
    expect(second.status).toBe(200);

    expect(querySearchAnalytics).toHaveBeenCalledTimes(1);
    if (second.status === 200) expect((await second.json()).gated).toBe(false);
  });

  test('revoked access marks the connection failed and degrades to gated', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics.mockRejectedValueOnce(new GscAuthRevokedError('revoked'));
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.summary.$get(
      { query: { org_id: 'org_1' } },
      opts,
    );

    expect(res.status).toBe(200);
    if (res.status === 200) {
      expect(await res.json()).toEqual({
        gated: true,
        totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
        deltas: { clicks: null, impressions: null, ctr: null, position: null },
        series: [],
      });
    }
    expect(markRefreshFailed).toHaveBeenCalledWith('org_1');
  });

  test('transient GSC errors degrade to gated without marking the connection', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics.mockRejectedValueOnce(new Error('boom'));
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.summary.$get(
      { query: { org_id: 'org_1' } },
      opts,
    );

    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).gated).toBe(true);
    expect(markRefreshFailed).not.toHaveBeenCalled();
  });
});

describe('GET /dashboard/analytics/articles', () => {
  test('gated shape when GSC is not connected', async () => {
    const res = await client.api.v0.dashboard.analytics.articles.$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    expect(await res.json()).toEqual({ gated: true, articles: [] });
    expect(querySearchAnalytics).not.toHaveBeenCalled();
  });

  test('two page-dimension calls (current + prior windows) with rowLimit 25000', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.articles.$get(
      { query: { org_id: 'org_1', range: '30d' } },
      opts,
    );

    expect(res.status).toBe(200);
    expect(querySearchAnalytics).toHaveBeenCalledTimes(2);
    expect(querySearchAnalytics).toHaveBeenNthCalledWith(
      1,
      'fake-refresh-token',
      'https://site.com',
      {
        startDate: '2026-07-10',
        endDate: '2026-08-08',
        dimensions: ['page'],
        rowLimit: 25000,
      },
    );
    expect(querySearchAnalytics).toHaveBeenNthCalledWith(
      2,
      'fake-refresh-token',
      'https://site.com',
      {
        startDate: '2026-06-10',
        endDate: '2026-07-09',
        dimensions: ['page'],
        rowLimit: 25000,
      },
    );
  });

  test('every published article appears; matched rows aggregate, unmatched get zeros', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics
      .mockResolvedValueOnce([
        {
          keys: ['https://site.com/blog/landing-pages'],
          clicks: 110,
          impressions: 1000,
          ctr: 0.11,
          position: 4,
        },
        {
          keys: ['http://www.site.com/landing-pages/'],
          clicks: 10,
          impressions: 100,
          ctr: 0.1,
          position: 6,
        },
      ])
      .mockResolvedValueOnce([
        {
          keys: ['https://site.com/blog/landing-pages'],
          clicks: 100,
          impressions: 900,
          ctr: 0.111,
          position: 5,
        },
      ]);
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.articles.$get(
      { query: { org_id: 'org_1', range: '30d' } },
      opts,
    );

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const body = await res.json();
    expect(body.gated).toBe(false);
    expect(body.articles).toHaveLength(3);

    const pub = body.articles.find((a) => a.article_id === 'art_pub');
    expect(pub?.clicks).toBe(120);
    expect(pub?.impressions).toBe(1100);
    expect(pub?.ctr).toBeCloseTo(120 / 1100, 6);
    expect(pub?.position).toBeCloseTo(4600 / 1100, 6);
    expect(pub?.days_live).toBe(71);
    expect(pub?.trend).toBe('up');
    expect(pub?.data_state).toBe('ok');

    const fresh = body.articles.find((a) => a.article_id === 'art_new');
    expect(fresh).toEqual({
      article_id: 'art_new',
      title: 'Fresh Post',
      published_at: '2026-08-09T12:00:00.000Z',
      days_live: 2,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      trend: null,
      data_state: 'awaiting',
    });
  });

  test('no row but ≥ 4 days live → ok with zero metrics; matched but < 14 days → gathering with null trend', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics
      .mockResolvedValueOnce([
        {
          keys: ['https://site.com/blog/mid-post'],
          clicks: 5,
          impressions: 50,
          ctr: 0.1,
          position: 8,
        },
      ])
      .mockResolvedValueOnce([]);
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.articles.$get(
      { query: { org_id: 'org_1', range: '30d' } },
      opts,
    );

    expect(res.status).toBe(200);
    if (res.status !== 200) return;
    const body = await res.json();

    const mid = body.articles.find((a) => a.article_id === 'art_mid');
    expect(mid?.days_live).toBe(10);
    expect(mid?.clicks).toBe(5);
    expect(mid?.trend).toBeNull();
    expect(mid?.data_state).toBe('gathering');

    const pub = body.articles.find((a) => a.article_id === 'art_pub');
    expect(pub).toEqual({
      article_id: 'art_pub',
      title: 'Landing Pages',
      published_at: '2026-06-01T00:00:00.000Z',
      days_live: 71,
      clicks: 0,
      impressions: 0,
      ctr: 0,
      position: 0,
      trend: null,
      data_state: 'ok',
    });
  });

  test('revoked access marks the connection failed and degrades to gated', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics.mockRejectedValueOnce(new GscAuthRevokedError('revoked'));
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.articles.$get(
      { query: { org_id: 'org_1' } },
      opts,
    );

    expect(res.status).toBe(200);
    if (res.status === 200) expect(await res.json()).toEqual({ gated: true, articles: [] });
    expect(markRefreshFailed).toHaveBeenCalledWith('org_1');
  });

  test('transient GSC errors degrade to gated without marking the connection', async () => {
    connectGsc('org_1', 'https://site.com');
    querySearchAnalytics.mockRejectedValueOnce(new Error('boom'));
    const opts = await auth();

    const res = await client.api.v0.dashboard.analytics.articles.$get(
      { query: { org_id: 'org_1' } },
      opts,
    );

    expect(res.status).toBe(200);
    if (res.status === 200) expect(await res.json()).toEqual({ gated: true, articles: [] });
    expect(markRefreshFailed).not.toHaveBeenCalled();
  });
});
