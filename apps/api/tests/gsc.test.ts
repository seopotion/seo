import { randomBytes } from 'node:crypto';
import type { Context, Next } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { decryptSecret } from '../src/lib/crypto';
import { signGscState } from '../src/lib/gsc-state';
import type { AuthEnv } from '../src/middlewares/auth';

const key = randomBytes(32);
vi.mock('../src/lib/secrets', () => ({
  getGscTokenKey: vi.fn(async () => key),
  getGoogleClientSecret: vi.fn(async () => 'client-secret'),
}));

const { buildAuthUrl, exchangeCode, listSites } = vi.hoisted(() => ({
  buildAuthUrl: vi.fn(async (state: string) => `https://consent.example/?state=${state}`),
  exchangeCode: vi.fn(async () => ({ refreshToken: 'rt-1', email: 'owner@x.com' })),
  listSites: vi.fn(async () => [
    { site_url: 'sc-domain:clewas.com', permission_level: 'siteOwner' },
  ]),
}));
vi.mock('../src/clients/gsc', () => ({ buildAuthUrl, exchangeCode, listSites }));

const { findById, connections, cacheDeleteByOrgId } = vi.hoisted(() => {
  const now = new Date();
  const orgs = new Map<string, Record<string, unknown>>([
    ['org_1', { id: 'org_1', user_id: 'u1', website_url: 'https://clewas.com', created_at: now }],
    ['org_3', { id: 'org_3', user_id: 'u2', website_url: 'https://other.com', created_at: now }],
  ]);
  return {
    findById: vi.fn(async (id: string) => orgs.get(id) ?? null),
    connections: new Map<string, Record<string, unknown>>(),
    cacheDeleteByOrgId: vi.fn(async () => 0),
  };
});
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  GscConnectionRepo: {
    findByOrgId: vi.fn(async (orgId: string) => connections.get(orgId) ?? null),
    upsertToken: vi.fn(async (orgId: string, enc: string, email: string) => {
      connections.set(orgId, {
        id: 'c1',
        org_id: orgId,
        refresh_token_enc: enc,
        google_email: email,
        site_url: null,
        connected_at: new Date(),
        last_refresh_failed_at: null,
      });
    }),
    setSiteUrl: vi.fn(async (orgId: string, siteUrl: string) => {
      const c = connections.get(orgId);
      if (c) c.site_url = siteUrl;
    }),
    deleteByOrgId: vi.fn(async (orgId: string) => connections.delete(orgId)),
  },
  GscAnalyticsCacheRepo: { deleteByOrgId: cacheDeleteByOrgId },
}));

// authMiddleware sets c.var.auth from the JWT; stub it to a fixed user.
vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: Context<AuthEnv>, next: Next) => {
      c.set('auth', { userId: 'u1', email: 'u1@example.com' });
      await next();
    },
  };
});

import app from '../src/routes/gsc';

const client = testClient(app);

beforeEach(() => {
  vi.clearAllMocks();
  connections.clear();
});

describe('GET /auth-url', () => {
  test('returns a consent URL carrying a signed state', async () => {
    const res = await client['auth-url'].$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      expect((await res.json()).url).toMatch(/^https:\/\/consent\.example\/\?state=/);
    }
  });

  test('404s for an org the caller does not own', async () => {
    const res = await client['auth-url'].$get({ query: { org_id: 'org_3' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /connect', () => {
  test('exchanges the code, stores the encrypted token, returns org_id + sites', async () => {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    const res = await client.connect.$post({ json: { code: 'auth-code', state } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.org_id).toBe('org_1');
      expect(body.sites).toEqual([
        { site_url: 'sc-domain:clewas.com', permission_level: 'siteOwner' },
      ]);
    }
    // Stored token is encrypted — decrypting with the mocked key recovers it.
    const stored = connections.get('org_1');
    expect(stored?.refresh_token_enc).not.toBe('rt-1');
    expect(decryptSecret(stored?.refresh_token_enc as string, key)).toBe('rt-1');
    expect(stored?.site_url).toBeNull();
  });

  test('rejects a tampered state', async () => {
    const res = await client.connect.$post({ json: { code: 'c', state: 'garbage' } });
    expect(res.status).toBe(400);
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  test("rejects a state minted for another user's session", async () => {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u2' });
    const res = await client.connect.$post({ json: { code: 'c', state } });
    expect(res.status).toBe(400);
  });

  test('404s when the state org is not owned by the caller', async () => {
    const state = await signGscState({ org_id: 'org_3', user_id: 'u1' });
    const res = await client.connect.$post({ json: { code: 'c', state } });
    expect(res.status).toBe(404);
  });

  test('400s when the Google exchange fails', async () => {
    exchangeCode.mockRejectedValueOnce(new Error('invalid code'));
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    const res = await client.connect.$post({ json: { code: 'bad', state } });
    expect(res.status).toBe(400);
  });

  // #103: the token is already stored (pending); a transient Google failure
  // listing properties is a 503 with a body, not an uncaught 500.
  test('503s when listing the properties fails, keeping the stored token', async () => {
    listSites.mockRejectedValueOnce(new Error('GSC sites list failed (502)'));
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    const res = await client.connect.$post({ json: { code: 'auth-code', state } });
    expect(res.status).toBe(503);
    if (res.status === 503) expect((await res.json()).error).toMatch(/unavailable/);
    expect(connections.get('org_1')?.site_url).toBeNull();
    expect(decryptSecret(connections.get('org_1')?.refresh_token_enc as string, key)).toBe('rt-1');
  });
});

describe('POST /site', () => {
  async function connect() {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    await client.connect.$post({ json: { code: 'auth-code', state } });
  }

  test('finalizes with a site from the account list', async () => {
    await connect();
    const res = await client.site.$post({
      json: { org_id: 'org_1', site_url: 'sc-domain:clewas.com' },
    });
    expect(res.status).toBe(200);
    expect(connections.get('org_1')?.site_url).toBe('sc-domain:clewas.com');
    // Validation re-lists with the decrypted token.
    expect(listSites).toHaveBeenLastCalledWith('rt-1');
  });

  test('rejects a site not in the account', async () => {
    await connect();
    const res = await client.site.$post({
      json: { org_id: 'org_1', site_url: 'sc-domain:evil.com' },
    });
    expect(res.status).toBe(400);
    expect(connections.get('org_1')?.site_url).toBeNull();
  });

  test('400s when no connection is pending', async () => {
    const res = await client.site.$post({ json: { org_id: 'org_1', site_url: 'x' } });
    expect(res.status).toBe(400);
  });

  test('503s when re-listing the properties fails, storing nothing (#103)', async () => {
    await connect();
    listSites.mockRejectedValueOnce(new Error('GSC sites list failed (502)'));
    const res = await client.site.$post({
      json: { org_id: 'org_1', site_url: 'sc-domain:clewas.com' },
    });
    expect(res.status).toBe(503);
    expect(connections.get('org_1')?.site_url).toBeNull();
  });
});

describe('DELETE /', () => {
  test('disconnects and reports whether a row existed', async () => {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    await client.connect.$post({ json: { code: 'auth-code', state } });

    const res = await client.index.$delete({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).ok).toBe(true);
    expect(connections.has('org_1')).toBe(false);
    expect(cacheDeleteByOrgId).toHaveBeenCalledWith('org_1');
  });
});

describe('GET /status', () => {
  async function connect() {
    const state = await signGscState({ org_id: 'org_1', user_id: 'u1' });
    await client.connect.$post({ json: { code: 'auth-code', state } });
  }

  test('reports a clean not-connected state when no row exists', async () => {
    const res = await client.status.$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      expect(await res.json()).toEqual({
        connected: false,
        google_email: null,
        site_url: null,
        connected_at: null,
        needs_reconnect: false,
      });
    }
  });

  test('after /connect is pending: account email set, property still null', async () => {
    await connect();
    const res = await client.status.$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.connected).toBe(false);
      expect(body.google_email).toBe('owner@x.com');
      expect(body.site_url).toBeNull();
      expect(body.needs_reconnect).toBe(false);
      expect(typeof body.connected_at).toBe('string');
      expect(Number.isNaN(Date.parse(body.connected_at as string))).toBe(false);
    }
  });

  test('after /site is chosen: connected with the property set', async () => {
    await connect();
    await client.site.$post({ json: { org_id: 'org_1', site_url: 'sc-domain:clewas.com' } });
    const res = await client.status.$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.connected).toBe(true);
      expect(body.site_url).toBe('sc-domain:clewas.com');
      expect(body.needs_reconnect).toBe(false);
    }
  });

  test('flags needs_reconnect when the last refresh failed', async () => {
    await connect();
    await client.site.$post({ json: { org_id: 'org_1', site_url: 'sc-domain:clewas.com' } });
    // Simulate Google revoking the grant — the API stamps this on a failed read.
    connections.get('org_1')!.last_refresh_failed_at = new Date();
    const res = await client.status.$get({ query: { org_id: 'org_1' } });
    expect(res.status).toBe(200);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.connected).toBe(false);
      expect(body.needs_reconnect).toBe(true);
    }
  });

  test('404s for an org the caller does not own', async () => {
    const res = await client.status.$get({ query: { org_id: 'org_3' } });
    expect(res.status).toBe(404);
  });
});
