import { beforeEach, describe, expect, test, vi } from 'vitest';

// The typed client builds URLs from the route types, so these tests are how we
// check the paths this app actually calls without standing up the admin API.
// `fetch` is captured when `getAdminApiClient` runs at module load, so the stub
// has to be in place before `../src/lib/queries` is imported.
type Call = { url: string; method: string; auth: string | null; body: string | null };
const calls: Call[] = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };
let replyQueue: Array<{ status: number; body: unknown }> = [];

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
  // The unstick levers that succeed with 204 have no body to send, and
  // constructing a `Response` with one at that status throws.
  const currentReply = replyQueue.shift() ?? reply;
  return new Response(currentReply.status === 204 ? null : JSON.stringify(currentReply.body), {
    status: currentReply.status,
    headers: { 'content-type': 'application/json' },
  });
});

const {
  ArticleValidationError,
  connectWordPress,
  createArticle,
  disconnectGsc,
  disconnectWordPress,
  fetchAllCandidates,
  fetchArticle,
  fetchArticles,
  fetchAudit,
  fetchOrg,
  fetchPublishingTargets,
  publishToStaticSite,
  publishToWordPress,
  rerunScan,
  resetGeneration,
  restoreCandidate,
  retryImages,
  runStrategy,
  searchOrgs,
  setPlan,
  updateArticle,
  updateBrief,
  updatePresets,
  updateWordPressPost,
} = await import('../src/lib/queries');
const { ApiError } = await import('../src/lib/api');

beforeEach(() => {
  calls.length = 0;
  reply = { status: 200, body: {} };
  replyQueue = [];
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

  test('sends { force: true } for the phase-2 re-run', async () => {
    reply = { status: 200, body: { strategy_status: 'pending' } };

    await runStrategy('org1', true);
    expect(calls[0]?.body).toBe('{"force":true}');
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

describe('rerunScan', () => {
  test('posts to the org scan route', async () => {
    reply = { status: 200, body: { enqueued: true } };

    await expect(rerunScan('org1')).resolves.toEqual({ enqueued: true });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/scan');
  });

  test('surfaces the live-org refusal as its code', async () => {
    reply = { status: 409, body: { error: 'setup_complete' } };

    await expect(rerunScan('org1')).rejects.toMatchObject({
      code: 'setup_complete',
      status: 409,
    });
  });
});

describe('WordPress connect / disconnect', () => {
  test('connect sends only the plugin token', async () => {
    reply = { status: 200, body: { success: true } };

    await expect(connectWordPress('org1', 'plugin-key')).resolves.toEqual({ success: true });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/integrations/wordpress');
    expect(calls[0]?.body).toBe('{"token":"plugin-key"}');
  });

  test('lifts the verify failure out of its { success, error_code } envelope', async () => {
    // Not the admin `{ error }` shape, so without the explicit lift the operator
    // would read "Forbidden" instead of what the plugin actually said.
    reply = { status: 403, body: { success: false, error_code: 'invalid_integration_key' } };

    await expect(connectWordPress('org1', 'bad-key')).rejects.toMatchObject({
      code: 'invalid_integration_key',
      status: 403,
    });
  });

  test('lifts a plugin/network failure the same way', async () => {
    reply = { status: 502, body: { success: false, error_code: 'wordpress_request_failed' } };

    await expect(connectWordPress('org1', 'plugin-key')).rejects.toMatchObject({
      code: 'wordpress_request_failed',
      status: 502,
    });
  });

  test('disconnect DELETEs the integration', async () => {
    reply = { status: 204, body: null };

    await expect(disconnectWordPress('org1')).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/integrations/wordpress');
  });

  test('surfaces the not-connected refusal as its code', async () => {
    reply = { status: 409, body: { error: 'wordpress_not_connected' } };

    await expect(disconnectWordPress('org1')).rejects.toMatchObject({
      code: 'wordpress_not_connected',
      status: 409,
    });
  });
});

describe('disconnectGsc', () => {
  test('DELETEs the connection', async () => {
    reply = { status: 204, body: null };

    await expect(disconnectGsc('org1')).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/gsc');
  });

  test('surfaces the not-connected refusal as its code', async () => {
    reply = { status: 409, body: { error: 'gsc_not_connected' } };

    await expect(disconnectGsc('org1')).rejects.toMatchObject({
      code: 'gsc_not_connected',
      status: 409,
    });
  });
});

describe('fetchAllCandidates', () => {
  test('retrieves every page for the selected status', async () => {
    replyQueue = [
      {
        status: 200,
        body: {
          candidates: Array.from({ length: 50 }, (_, index) => ({ id: `candidate-${index}` })),
          total: 51,
          limit: 50,
          offset: 0,
        },
      },
      {
        status: 200,
        body: {
          candidates: [{ id: 'candidate-50' }],
          total: 51,
          limit: 50,
          offset: 50,
        },
      },
    ];

    const candidates = await fetchAllCandidates('org1', 'candidate');

    expect(candidates).toHaveLength(51);
    expect(calls.map((call) => call.url)).toEqual([
      'http://localhost:8788/admin/v0/orgs/org1/candidates?status=candidate&limit=50&offset=0',
      'http://localhost:8788/admin/v0/orgs/org1/candidates?status=candidate&limit=50&offset=50',
    ]);
  });
});

describe('restoreCandidate', () => {
  test('posts to the restore route', async () => {
    reply = { status: 204, body: null };

    await expect(restoreCandidate('cand1')).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/candidates/cand1/restore');
  });

  test('surfaces the conditional miss as its code', async () => {
    reply = { status: 409, body: { error: 'candidate_not_restorable' } };

    await expect(restoreCandidate('cand1')).rejects.toMatchObject({
      code: 'candidate_not_restorable',
      status: 409,
    });
  });
});

describe('resetGeneration', () => {
  test('posts to the reset route', async () => {
    reply = { status: 204, body: null };

    await expect(resetGeneration('kw1')).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/scheduled/kw1/reset');
  });

  test('surfaces the over-cap guard as its code', async () => {
    reply = { status: 409, body: { error: 'not_resettable' } };

    await expect(resetGeneration('kw1')).rejects.toMatchObject({
      code: 'not_resettable',
      status: 409,
    });
  });
});

describe('updateBrief', () => {
  const patch = {
    article_type: 'listicle' as const,
    intent: 'commercial' as const,
    opportunity_score: 42,
  };

  test('patches the three brief fields', async () => {
    reply = { status: 200, body: { keyword: { id: 'kw1' } } };

    await expect(updateBrief('kw1', patch)).resolves.toEqual({ keyword: { id: 'kw1' } });
    expect(calls[0]?.method).toBe('PATCH');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/scheduled/kw1/brief');
    expect(calls[0]?.body).toBe(JSON.stringify(patch));
  });

  test('sends nulls to clear a field', async () => {
    reply = { status: 200, body: { keyword: { id: 'kw1' } } };

    await updateBrief('kw1', { article_type: null, intent: null, opportunity_score: null });
    expect(calls[0]?.body).toBe('{"article_type":null,"intent":null,"opportunity_score":null}');
  });

  test('surfaces the generation lock as its code', async () => {
    reply = { status: 409, body: { error: 'generation_started' } };

    await expect(updateBrief('kw1', patch)).rejects.toMatchObject({
      code: 'generation_started',
      status: 409,
    });
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

describe('createArticle', () => {
  const draft = {
    keyword: 'focus keyword',
    title: 'T',
    slug: 's',
    meta_title: 'MT',
    meta_description: 'MD',
    content: '## Body',
  };

  test('POSTs the draft to the org route and returns the 201 response', async () => {
    reply = { status: 201, body: { id: 'art1', title: 'T' } };

    await expect(createArticle('org1', draft)).resolves.toEqual({ id: 'art1', title: 'T' });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/orgs/org1/articles');
    expect(calls[0]?.body).toBe(JSON.stringify(draft));
  });

  test('sends a null focus keyword unchanged', async () => {
    reply = { status: 201, body: { id: 'art1' } };

    await createArticle('org1', { ...draft, keyword: null });
    expect(calls[0]?.body).toBe(JSON.stringify({ ...draft, keyword: null }));
  });

  test('carries the per-field messages of a 400 through to the form', async () => {
    reply = {
      status: 400,
      body: { error: 'validation_failed', fields: { title: 'Title is required' } },
    };

    await expect(createArticle('org1', draft)).rejects.toBeInstanceOf(ArticleValidationError);
    await expect(createArticle('org1', draft)).rejects.toMatchObject({
      code: 'validation_failed',
      fields: { title: 'Title is required' },
    });
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

describe('publishing targets and static-site publish', () => {
  test('loads targets by article id without an org query parameter', async () => {
    reply = {
      status: 200,
      body: {
        destinations: [
          {
            provider: 'static-site',
            target: 'customer/repository@main',
            connected_at: '2026-09-01T00:00:00.000Z',
            last_error: null,
          },
        ],
      },
    };

    await expect(fetchPublishingTargets('art1')).resolves.toEqual(reply.body);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/articles/art1/publishing-targets');
  });

  test('publishes to the static-site article route', async () => {
    reply = {
      status: 200,
      body: {
        commit_sha: 'abc123',
        commit_url: 'https://github.com/customer/repository/commit/abc123',
        path: 'seopotion/articles/guide.md',
      },
    };

    await expect(publishToStaticSite('art1')).resolves.toEqual(reply.body);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/articles/art1/static-site');
  });

  test('surfaces a static-site refusal as its error code', async () => {
    reply = { status: 409, body: { error: 'slug_conflict' } };

    await expect(publishToStaticSite('art1')).rejects.toMatchObject({
      code: 'slug_conflict',
      status: 409,
    });
  });
});

describe('retryImages', () => {
  test('posts to the article images route', async () => {
    reply = { status: 200, body: { enqueued: true } };

    await expect(retryImages('art1')).resolves.toEqual({ enqueued: true });
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://localhost:8788/admin/v0/articles/art1/images');
  });
});
