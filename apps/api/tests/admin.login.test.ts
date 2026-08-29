import { describe, expect, test, vi } from 'vitest';

// Allowlist with mixed case + stray whitespace + an empty entry — the login
// route must match case-insensitively and drop empties. Set BEFORE config.ts
// is imported (vi.hoisted runs ahead of the static imports below).
const identity = vi.hoisted(() => {
  process.env.ADMIN_OPERATORS = ' Op@Example.com ,, second@ops.dev ';
  return { email: 'op@example.com' };
});

vi.mock('../src/clients/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g-sub-op', email: identity.email, name: 'Op' })),
}));

// The admin app's org router + audit helper import repos at module level.
vi.mock('@shared/db', () => ({
  OrgRepo: {},
  UserRepo: {},
  SubscriptionRepo: {},
  GscConnectionRepo: {},
  KeywordRepo: {},
  ArticleRepo: {},
  AdminActionRepo: {},
  PromoCodeRepo: {
    create: vi.fn(),
    findByCode: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    deactivate: vi.fn(),
  },
  PromoRedemptionRepo: { countConfirmed: vi.fn(), listByCode: vi.fn() },
}));

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';

const client = testClient<AdminAppType>(adminApp);

function decodeClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString());
}

describe('POST /admin/v0/login', () => {
  test('allowlisted email -> 200 with an operator JWT', async () => {
    identity.email = 'op@example.com';
    const res = await client.admin.v0.login.$post({ json: { id_token: 'fake-google-token' } });
    expect(res.status).toBe(200);

    const { token } = (await res.json()) as { token: string };
    expect(token.split('.')).toHaveLength(3);
    const claims = decodeClaims(token);
    expect(claims.sub).toBe('op@example.com');
    expect(claims.email).toBe('op@example.com');
    expect(claims.role).toBe('operator');
  });

  test('allowlist matching is case-insensitive and trims whitespace', async () => {
    identity.email = 'SECOND@OPS.dev';
    const res = await client.admin.v0.login.$post({ json: { id_token: 'fake-google-token' } });
    expect(res.status).toBe(200);
    const { token } = (await res.json()) as { token: string };
    expect(decodeClaims(token).sub).toBe('second@ops.dev');
  });

  test('non-allowlisted email -> 403 not_an_operator', async () => {
    identity.email = 'intruder@example.com';
    const res = await client.admin.v0.login.$post({ json: { id_token: 'fake-google-token' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_an_operator' });
  });
});
