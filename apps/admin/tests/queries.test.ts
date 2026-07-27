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

const {
  ArticleValidationError,
  fetchArticle,
  fetchArticles,
  fetchAudit,
  fetchOrg,
  publishToWordPress,
  runStrategy,
  searchOrgs,
  setPlan,
  updateArticle,
  updatePresets,
  updateWordPressPost,
} = await import('../src/lib/queries');
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

describe('updatePresets', () => {
  test('patches only the subtree it is given', async () => {
    reply = { status: 200, body: { presets: { business: { name: 'Acme Corp' } } } };

    await updatePresets('org1', { business: { name: 'Acme Corp' } });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/presets');
    expect(calls[0]?.body).toBe('{"business":{"name":"Acme Corp"}}');
  });

  test('surfaces the no-presets refusal as its code', async () => {
    reply = { status: 409, body: { error: 'no_presets' } };

    await expect(updatePresets('org1', { business: { name: 'x' } })).rejects.toMatchObject({
      code: 'no_presets',
      status: 409,
    });
  });
});

describe('runStrategy', () => {
  test('posts an empty body — force is a phase-2 lever', async () => {
    reply = { status: 200, body: { strategy_status: 'pending' } };

    await expect(runStrategy('org1')).resolves.toEqual({ strategy_status: 'pending' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/strategy');
    expect(calls[0]?.body).toBe('{}');
  });

  test('surfaces the claim refusal as its code', async () => {
    reply = { status: 409, body: { error: 'strategy_not_claimable' } };

    await expect(runStrategy('org1')).rejects.toMatchObject({
      code: 'strategy_not_claimable',
      status: 409,
    });
  });
});

describe('fetchAudit', () => {
  test('sends the page window', async () => {
    reply = { status: 200, body: { actions: [], total: 0 } };

    await fetchAudit('org1', 50);
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/audit?limit=50&offset=50');
  });
});

describe('fetchArticles', () => {
  test('sends the status filter and page window', async () => {
    reply = { status: 200, body: { articles: [], total: 0 } };

    await fetchArticles('org1', 'published', 20);
    expect(calls[0]?.url).toBe(
      'http://localhost:8788/admin/v0/orgs/org1/articles?status=published&limit=20&offset=20',
    );
  });

  test('omits the status entirely when unfiltered', async () => {
    reply = { status: 200, body: { articles: [], total: 0 } };

    await fetchArticles('org1', null);
    expect(calls[0]?.url).toBe(
      'http://localhost:8788/admin/v0/orgs/org1/articles?limit=20&offset=0',
    );
  });
});

describe('fetchArticle', () => {
  test('requests the article by id', async () => {
    reply = { status: 200, body: { id: 'art1' } };

    await expect(fetchArticle('art1')).resolves.toEqual({ id: 'art1' });
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/articles/art1');
  });

  test('turns a 404 into the not_found code the page renders', async () => {
    reply = { status: 404, body: { error: 'not_found' } };

    await expect(fetchArticle('missing')).rejects.toMatchObject({ code: 'not_found', status: 404 });
  });
});

describe('updateArticle', () => {
  const draft = {
    title: 'T',
    slug: 's',
    meta_title: 'MT',
    meta_description: 'MD',
    content: '## Body',
  };

  test('patches the five editable fields', async () => {
    reply = { status: 200, body: { id: 'art1', title: 'T' } };

    await expect(updateArticle('art1', draft)).resolves.toEqual({ id: 'art1', title: 'T' });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/articles/art1');
    expect(calls[0]?.body).toBe(JSON.stringify(draft));
  });

  test('carries the per-field messages of a 400 through to the editor', async () => {
    reply = {
      status: 400,
      body: { error: 'validation_failed', fields: { slug: 'Slug is required' } },
    };

    await expect(updateArticle('art1', draft)).rejects.toBeInstanceOf(ArticleValidationError);
    await expect(updateArticle('art1', draft)).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { slug: 'Slug is required' },
    });
  });

  test('surfaces the images guard as its 409 code', async () => {
    reply = { status: 409, body: { error: 'images_in_progress' } };

    await expect(updateArticle('art1', draft)).rejects.toMatchObject({
      code: 'images_in_progress',
      status: 409,
    });
  });
});

describe('WordPress publish/update', () => {
  test('publish POSTs to the article WordPress route', async () => {
    reply = { status: 200, body: { success: true, post_id: 42 } };

    await expect(publishToWordPress('art1')).resolves.toEqual({ success: true, post_id: 42 });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/articles/art1/wordpress');
  });

  test('update PUTs to the same route', async () => {
    reply = { status: 200, body: { success: true, post_id: 42 } };

    await updateWordPressPost('art1');
    expect(calls[0]?.method).toBe('PUT');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/articles/art1/wordpress');
  });

  test('surfaces a publish refusal as its error code', async () => {
    reply = { status: 409, body: { error: 'images_not_complete' } };

    await expect(publishToWordPress('art1')).rejects.toMatchObject({
      code: 'images_not_complete',
      status: 409,
    });
  });
});
