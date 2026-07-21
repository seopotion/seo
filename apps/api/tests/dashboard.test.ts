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

// Google verification is mocked — no network, no real token needed.
vi.mock('../src/clients/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g-sub-123', email: 'u@example.com', name: 'U' })),
}));

vi.mock('../src/clients/wordpress', () => ({
  editWordPressArticle,
  submitWordPressArticle,
  testWordPressIntegration,
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
      images_status: 'complete',
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
      images_status: 'complete',
      wordpress_post_id: 222,
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
      images_status: 'complete',
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
      created_at: now,
      published_at: null,
      images_status: 'complete',
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
      created_at: now,
      published_at: null,
      images_status: 'pending',
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
      created_at: now,
      published_at: null,
      images_status: 'pending',
      wordpress_post_id: 555,
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
    // Owned by a different user — used to prove ownership 404s don't leak.
    [
      'org_3',
      { id: 'org_3', user_id: 'user_2', website_url: 'https://other.com', created_at: now },
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
      setWordPressPostId,
    },
  };
});

import { ArticleRepo } from '@shared/db';
import { testClient } from 'hono/testing';
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
  // The setWordPressPostId mock persists onto the shared article fixture, so
  // clear the one field create tests mutate to keep each test isolated (the
  // create dup-guard rejects an article that already has a WordPress post ID).
  const seededCreateArticle = await ArticleRepo.findById('art_1');
  if (seededCreateArticle) delete seededCreateArticle.wordpress_post_id;
});

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
        id: 'wordpress',
        provider: 'wordpress',
        connected_at: expect.any(String),
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('never-return-this-token');
    expect(body.integrations[0]).not.toHaveProperty('token');
    expect(body.integrations[0]).not.toHaveProperty('wordpress_token');
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
    400, 403, 409, 500,
  ] as const)('passes through a plugin %s create response without persisting', async (status) => {
    submitWordPressArticle.mockResolvedValueOnce({
      status,
      body: { error: `plugin-${status}` },
    });

    const res = await client.api.v0.dashboard.articles[':id'].wordpress.$post(
      { param: { id: 'art_1' } },
      await auth(),
    );

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: `plugin-${status}` });
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
