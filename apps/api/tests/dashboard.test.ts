import { describe, expect, test, vi } from 'vitest';

// Google verification is mocked — no network, no real token needed.
vi.mock('../src/clients/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g-sub-123', email: 'u@example.com', name: 'U' })),
}));

vi.mock('@shared/db', () => ({
  UserRepo: {
    upsertByGoogleSub: vi.fn(async (input: { google_sub: string; email: string }) => ({
      id: 'user_1',
      google_sub: input.google_sub,
      email: input.email,
      created_at: new Date(),
    })),
  },
  OrgRepo: {},
}));

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
    const res = await client.api.v0.dashboard.planner.$get();
    expect(res.status).toBe(401);
  });

  test('GET /planner returns populated scheduled keywords', async () => {
    const res = await client.api.v0.dashboard.planner.$get(undefined, await auth());
    expect(res.status).toBe(200);
    const { keywords } = await res.json();
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords[0]).toMatchObject({
      status: 'scheduled',
      keyword: expect.any(String),
      search_volume: expect.any(Number),
    });
    // Mix of generated (article_id set) and not-yet-generated (null) cards.
    expect(keywords.some((k) => k.article_id !== null)).toBe(true);
    expect(keywords.some((k) => k.article_id === null)).toBe(true);
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

  test('GET + PATCH /settings/articles deep-merges a partial', async () => {
    const opts = await auth();
    const get = await client.api.v0.dashboard.settings.articles.$get(undefined, opts);
    expect(get.status).toBe(200);
    expect((await get.json()).article_preferences.engagement.image_style).toBeTruthy();

    const patched = await client.api.v0.dashboard.settings.articles.$patch(
      { json: { engagement: { image_style: 'Watercolor' } } },
      opts,
    );
    expect(patched.status).toBe(200);
    const body = await patched.json();
    expect(body.article_preferences.engagement.image_style).toBe('Watercolor');
    // Sibling content_seo left untouched by the merge.
    expect(body.article_preferences.content_seo.article_style).toBeTruthy();
  });

  test('GET + PATCH /settings/general deep-merges a partial', async () => {
    const opts = await auth();
    const get = await client.api.v0.dashboard.settings.general.$get(undefined, opts);
    expect(get.status).toBe(200);
    expect((await get.json()).business.name).toBeTruthy();

    const patched = await client.api.v0.dashboard.settings.general.$patch(
      { json: { business: { name: 'Renamed Co' } } },
      opts,
    );
    expect(patched.status).toBe(200);
    const body = await patched.json();
    expect(body.business.name).toBe('Renamed Co');
    // Audience untouched; language sibling preserved.
    expect(body.business.language).toBeTruthy();
    expect(body.audience.competitors.length).toBeGreaterThan(0);
  });
});
