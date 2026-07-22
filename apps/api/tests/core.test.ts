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
  OrgRepo: {
    findByUserId: vi.fn(async (userId: string) =>
      userId === 'user_1'
        ? [
            {
              id: 'org_1',
              user_id: 'user_1',
              website_url: 'https://example.com',
              setup_status: 'setup_complete',
              wordpress_token: 'never-return-this-token',
              wordpress_connected_at: new Date('2026-07-14T10:00:00.000Z'),
              created_at: new Date(),
            },
          ]
        : [],
    ),
  },
}));

import { testClient } from 'hono/testing';
import app, { type AppType } from '../src/routes';

const client = testClient<AppType>(app);

async function login(): Promise<string> {
  const res = await client.api.v0.core.login.$post({ json: { id_token: 'fake-google-token' } });
  const { token } = await res.json();
  return token;
}

describe('core auth routes', () => {
  test('POST /login exchanges a Google token for a JWT', async () => {
    const res = await client.api.v0.core.login.$post({ json: { id_token: 'fake-google-token' } });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(typeof json.token).toBe('string');
    expect(json.token.split('.')).toHaveLength(3); // header.payload.signature
  });

  test('GET /organizations rejects requests without a token', async () => {
    const res = await client.api.v0.core.organizations.$get();
    expect(res.status).toBe(401);
  });

  test('GET /organizations rejects an invalid token', async () => {
    const res = await client.api.v0.core.organizations.$get(undefined, {
      headers: { Authorization: 'Bearer not-a-jwt' },
    });
    expect(res.status).toBe(401);
  });

  test('GET /organizations returns the user orgs with a valid token', async () => {
    const token = await login();
    const res = await client.api.v0.core.organizations.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.organizations).toHaveLength(1);
    expect(json.organizations[0]?.id).toBe('org_1');
    expect(JSON.stringify(json)).not.toContain('never-return-this-token');
    expect(json.organizations[0]).not.toHaveProperty('wordpress_token');
    // Free/legacy org (no plan): capabilities are computed server-side as false.
    expect(json.organizations[0]?.capabilities).toEqual({
      keyword_research: false,
      keyword_scheduling: false,
    });
  });

  test('GET /organizations reports capabilities true for a paid org', async () => {
    const { OrgRepo } = await import('@shared/db');
    vi.mocked(OrgRepo.findByUserId).mockResolvedValueOnce([
      {
        id: 'org_paid',
        user_id: 'user_1',
        website_url: 'https://example.com',
        setup_status: 'setup_complete',
        plan: 'paid',
        strategy_status: 'none',
        created_at: new Date(),
      },
    ]);
    const token = await login();
    const res = await client.api.v0.core.organizations.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations[0]?.capabilities).toEqual({
      keyword_research: true,
      keyword_scheduling: true,
    });
  });

  test('GET /status reflects setup completion', async () => {
    const token = await login();
    const res = await client.api.v0.core.status.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.setup_complete).toBe(true);
  });
});
