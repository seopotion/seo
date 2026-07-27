import { beforeEach, describe, expect, test, vi } from 'vitest';

// The typed client builds URLs from the route types, so these tests are how we
// check the paths this app actually calls without standing up the admin API.
// `fetch` is captured when `getAdminApiClient` runs at module load, so the stub
// has to be in place before `../src/lib/queries` is imported.
type Call = { url: string; method: string; auth: string | null; body: string | null };
const calls: Call[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

vi.stubGlobal('window', {
  localStorage: {
    getItem: () => 'admin.jwt.value',
    setItem: () => undefined,
    removeItem: () => undefined,
  },
  location: { assign: () => undefined },
});

vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const request = new Request(input, init);
  calls.push({
    url: request.url,
    method: request.method,
    auth: request.headers.get('Authorization'),
    body: request.body ? await request.text() : null,
  });
  return new Response(JSON.stringify(reply.body), {
    status: reply.status,
    headers: { 'content-type': 'application/json' },
  });
});

const { fetchOrg, searchOrgs, setPlan } = await import('../src/lib/queries');
const { ApiError } = await import('../src/lib/api');

beforeEach(() => {
  calls.length = 0;
  reply = { status: 200, body: {} };
});

describe('searchOrgs', () => {
  test('sends the query and returns the org list', async () => {
    reply = { status: 200, body: { orgs: [{ id: 'org1' }] } };

    await expect(searchOrgs('acme.com')).resolves.toEqual({ orgs: [{ id: 'org1' }] });
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs?query=acme.com');
    expect(calls[0]?.auth).toBe('Bearer admin.jwt.value');
  });
});

describe('fetchOrg', () => {
  test('requests the org by id', async () => {
    reply = { status: 200, body: { org: { id: 'org1' } } };

    await expect(fetchOrg('org1')).resolves.toEqual({ org: { id: 'org1' } });
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1');
  });

  test('turns a 404 into the not_found code the workspace renders', async () => {
    reply = { status: 404, body: { error: 'not_found' } };

    await expect(fetchOrg('missing')).rejects.toMatchObject({ code: 'not_found', status: 404 });
    await expect(fetchOrg('missing')).rejects.toBeInstanceOf(ApiError);
  });
});

describe('setPlan', () => {
  test('posts the plan to the org', async () => {
    reply = { status: 200, body: { plan: 'expert', strategy_kicked: true } };

    await expect(setPlan('org1', 'expert')).resolves.toEqual({
      plan: 'expert',
      strategy_kicked: true,
    });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/plan');
    expect(calls[0]?.body).toBe('{"plan":"expert"}');
  });

  test('surfaces an API refusal as its error code', async () => {
    reply = { status: 409, body: { error: 'strategy_not_claimable' } };

    await expect(setPlan('org1', 'paid')).rejects.toMatchObject({
      code: 'strategy_not_claimable',
      status: 409,
    });
  });
});
