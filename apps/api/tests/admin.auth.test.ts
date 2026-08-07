import { describe, expect, test, vi } from 'vitest';

// The load-bearing isolation proofs (epic #150): a customer token must be
// rejected by admin routes and vice versa (the local env-var default secrets
// differ, making cross-validation fail cryptographically), and every admin
// route registered after the router-global middleware fails closed.

// Pin the env this file depends on (vi.hoisted runs before the static imports;
// other admin test files set ADMIN_OPERATORS, which could leak between files
// sharing a worker process): empty allowlist, distinct default secrets.
vi.hoisted(() => {
  process.env.ADMIN_OPERATORS = '';
  delete process.env.JWT_SECRET;
  delete process.env.ADMIN_JWT_SECRET;
});

// Both apps are imported whole, so mock every module-level @shared/db import.
vi.mock('@shared/db', () => ({
  OrgRepo: {},
  UserRepo: {},
  SubscriptionRepo: {},
  GscConnectionRepo: {},
  KeywordRepo: {},
  ArticleRepo: {},
  CandidateRepo: {},
  AdminActionRepo: {},
  addCandidates: vi.fn(),
  scheduleCandidate: vi.fn(),
  isDuplicateKeyError: vi.fn(() => false),
}));

vi.mock('../src/clients/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g', email: 'op@example.com', name: 'Op' })),
}));

import adminApp from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';
import { signToken } from '../src/auth/jwt';
import customerApp from '../src/routes';

describe('cross-secret isolation', () => {
  test('a token signed with the customer secret -> 401 on an admin route', async () => {
    const customerToken = await signToken({ sub: 'user_1', email: 'u@example.com' });
    const res = await adminApp.request('/admin/v0/orgs?query=example', {
      headers: { Authorization: `Bearer ${customerToken}` },
    });
    expect(res.status).toBe(401);
  });

  test('a token signed with the admin secret -> 401 on a customer route', async () => {
    const adminToken = await signAdminToken('op@example.com');
    const res = await customerApp.request('/api/v0/core/organizations', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.status).toBe(401);
  });
});

describe('fail-closed wiring', () => {
  // Public by design; everything else mounted on the admin app must 401.
  const PUBLIC = new Set(['/health', '/admin/v0/login', '/admin/v0/openapi.json', '/admin/v0/ui']);

  test('every mounted admin route without a token -> 401', async () => {
    const protectedRoutes = adminApp.routes.filter(
      (r) => r.method !== 'ALL' && !PUBLIC.has(r.path),
    );
    // Guard against the iteration silently matching nothing.
    expect(protectedRoutes.length).toBeGreaterThanOrEqual(3);

    for (const route of protectedRoutes) {
      const path = route.path.replace(/:[^/]+/g, '0'.repeat(24));
      const res = await adminApp.request(path, { method: route.method });
      expect(res.status, `${route.method} ${route.path}`).toBe(401);
    }
  });

  test('/health is reachable without a token', async () => {
    const res = await adminApp.request('/health');
    expect(res.status).toBe(200);
  });

  test('/login is reachable without a token', async () => {
    const res = await adminApp.request('/admin/v0/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: 'fake-google-token' }),
    });
    // 403 (empty allowlist), never 401 — the route is public.
    expect(res.status).toBe(403);
  });
});
