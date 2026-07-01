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
