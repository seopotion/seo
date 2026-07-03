import { describe, expect, test, vi } from 'vitest';

// Google verification is mocked — no network, no real token needed.
vi.mock('../src/clients/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g-sub-123', email: 'u@example.com', name: 'U' })),
}));

vi.mock('@shared/db', () => {
  // org_1 (owned by user_1) has data; org_2 (also user_1) is empty.
  const now = new Date('2026-07-02T08:00:00.000Z');
  const keywords = [
    {
      id: 'kw_1',
      org_id: 'org_1',
      keyword: 'landing pages',
      status: 'scheduled',
      scheduled_date: '2026-07-02',
      search_volume: 170,
      difficulty: 36,
      article_id: 'art_1',
      created_at: now,
    },
    {
      id: 'kw_2',
      org_id: 'org_1',
      keyword: 'notion builder',
      status: 'scheduled',
      scheduled_date: '2026-07-03',
      search_volume: 2400,
      difficulty: 48,
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
        presets: {
          business: {
            name: 'Clewas',
            language: 'English',
            country: 'Global (English)',
            description: 'desc',
          },
          audience: { target: 'creators', competitors: ['super.so', 'potion.so'] },
          blog: {
            sitemap_url: 'https://x/sitemap.xml',
            main_blog_url: 'https://x/blog',
            best_articles: [],
          },
          article_preferences: {
            content_seo: {
              article_style: 'Informative',
              internal_links: true,
              llm_instructions: 'x',
            },
            engagement: { image_style: 'Sketch' },
          },
        },
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
          audience: { target: 'creators', competitors: ['super.so', 'potion.so'] },
          blog: {
            sitemap_url: 'https://x/sitemap.xml',
            main_blog_url: 'https://x/blog',
            best_articles: [],
          },
          article_preferences: {
            content_seo: {
              article_style: 'Informative',
              internal_links: true,
              llm_instructions: 'x',
            },
            engagement: { image_style: 'Sketch' },
          },
        },
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
  };
});

import { testClient } from 'hono/testing';
import app, { type AppType } from '../src/routes';

const client = testClient<AppType>(app);

async function login(): Promise<string> {
  const res = await client.api.v0.core.login.$post({ json: { id_token: 'fake-google-token' } });
  const { token } = await res.json();
  return token;
}

describe('dashboard home routes', () => {
  test('reject requests without a token', async () => {
    const res = await client.api.v0.dashboard.articles.published.$get();
    expect(res.status).toBe(401);
  });

  test('GET /articles/published returns a count for a fresh org', async () => {
    const token = await login();
    const res = await client.api.v0.dashboard.articles.published.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(0);
  });

  test('GET /articles/planned returns a count for a fresh org', async () => {
    const token = await login();
    const res = await client.api.v0.dashboard.articles.planned.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).count).toBe(0);
  });

  test('GET /articles/best is empty and gated until Google data is connected', async () => {
    const token = await login();
    const res = await client.api.v0.dashboard.articles.best.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.articles).toHaveLength(0);
    expect(json.gated).toBe(true);
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
      const { keywords } = await res.json();
      expect(keywords.map((k) => k.keyword)).toEqual(['landing pages', 'notion builder']);
      expect(keywords[0]?.article_id).toBe('art_1');
      expect(keywords[1]?.article_id).toBeNull();
    }
  });

  test('GET /planner is empty for an org with no keywords', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'org_2' } }, opts);
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).keywords).toHaveLength(0);
  });

  test('GET /planner 404s for an org the caller does not own', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.planner.$get({ query: { org_id: 'nope' } }, opts);
    expect(res.status).toBe(404);
  });

  test('GET /articles returns rows + total, filterable by status', async () => {
    const opts = await auth();
    const all = await client.api.v0.dashboard.articles.$get({ query: {} }, opts);
    expect(all.status).toBe(200);
    const allBody = await all.json();
    expect(allBody.total).toBe(allBody.articles.length);
    expect(allBody.articles.length).toBeGreaterThan(1);

    const published = await client.api.v0.dashboard.articles.$get(
      { query: { status: 'published' } },
      opts,
    );
    const pubBody = await published.json();
    expect(pubBody.articles.every((a) => a.status === 'published')).toBe(true);
    expect(pubBody.total).toBeLessThan(allBody.total);
  });

  test('GET /articles/:id returns the article, 404 for unknown id', async () => {
    const opts = await auth();
    const ok = await client.api.v0.dashboard.articles[':id'].$get({ param: { id: 'art_1' } }, opts);
    expect(ok.status).toBe(200);
    if (ok.status === 200) {
      expect((await ok.json()).id).toBe('art_1');
    }

    const missing = await client.api.v0.dashboard.articles[':id'].$get(
      { param: { id: 'nope' } },
      opts,
    );
    expect(missing.status).toBe(404);
  });

  test('static /articles/best still resolves after adding /articles/:id', async () => {
    const res = await client.api.v0.dashboard.articles.best.$get(undefined, await auth());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.articles).toHaveLength(0);
    expect(json.gated).toBe(true);
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

  test('settings 404 for an org the caller does not own', async () => {
    const opts = await auth();
    const res = await client.api.v0.dashboard.settings.articles.$get(
      { query: { org_id: 'unknown' } },
      opts,
    );
    expect(res.status).toBe(404);
  });
});
