import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDataForSeoClient, domainRatingFromRank } from '../src';

function labsResponse(items: unknown[]) {
  return new Response(
    JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const client = () =>
  createDataForSeoClient({ login: 'u', password: 'p', maxRetries: 2, retryDelayMs: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('keywordsForSite', () => {
  test('sends Basic auth + normalizes items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      labsResponse([
        {
          keyword: 'Best SEO Tools',
          keyword_info: {
            search_volume: 1000,
            cpc: 2.5,
            competition: 0.3,
            search_volume_trend: { yearly: -12 },
          },
          keyword_properties: { keyword_difficulty: 40 },
          search_intent_info: { main_intent: 'commercial' },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().keywordsForSite({ target: 'example.com' });

    expect(out).toEqual([
      {
        keyword: 'Best SEO Tools',
        core_keyword: null,
        category_ids: [],
        search_volume: 1000,
        difficulty: 40,
        cpc: 2.5,
        competition: 0.3,
        trend: -12,
        intent: 'commercial',
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/dataforseo_labs/google/keywords_for_site/live');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('u:p').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual([{ target: 'example.com' }]);
  });

  test('nulls missing metrics and unknown intent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(labsResponse([{ keyword: 'seo audit' }])));
    const [out] = await client().keywordsForSite({ target: 'example.com' });
    expect(out).toEqual({
      keyword: 'seo audit',
      core_keyword: null,
      category_ids: [],
      search_volume: null,
      difficulty: null,
      cpc: null,
      competition: null,
      trend: null,
      intent: null,
    });
  });

  test('maps 401 to auth and does NOT retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      name: 'DataForSeoError',
      category: 'auth',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries on 500 up to maxRetries then throws provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      category: 'provider',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('retries 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(labsResponse([{ keyword: 'ok' }]));
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().keywordsForSite({ target: 'x' });
    expect(out[0]!.keyword).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('a thrown fetch (network) is categorized and retried', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      category: 'network',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('DataForSEO body error status_code maps without HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status_code: 40100, status_message: 'auth' }), {
          status: 200,
        }),
      ),
    );
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      category: 'auth',
    });
  });

  test('body errors carry the API status_message for diagnosis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status_code: 40501,
            status_message: "Invalid Field: 'location_name'.",
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toThrow(
      /Invalid Field: 'location_name'/,
    );
  });

  test('task-level errors carry the API status_message for diagnosis', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status_code: 20000,
            tasks: [{ status_code: 40501, status_message: 'Invalid Field: target.' }],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toThrow(
      /Invalid Field: target/,
    );
  });

  test('normalizes a full URL target to a bare domain', async () => {
    const fetchMock = vi.fn().mockResolvedValue(labsResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().keywordsForSite({ target: 'https://www.clewas.com/' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual([
      { target: 'clewas.com' },
    ]);
  });

  // Real depleted-account response observed 2026-07-23: HTTP 402 with a normal
  // envelope whose task carries 40200 "Payment Required." — the task message
  // must survive into the error, and the call must not be retried.
  test('HTTP 402 reads the body task error: payment_required, message kept, no retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status_code: 20000,
          status_message: 'Ok.',
          tasks: [{ status_code: 40200, status_message: 'Payment Required.' }],
        }),
        { status: 402 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      name: 'DataForSeoError',
      category: 'payment_required',
      status: 402,
      message: expect.stringMatching(/HTTP 402.*Payment Required\./),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('HTTP 402 without a parseable body still maps to payment_required', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      category: 'payment_required',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('non-JSON HTTP failure carries the status and a body snippet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('Bandwidth limit exceeded', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      category: 'invalid_request',
      status: 400,
      message: expect.stringMatching(/HTTP 400.*Bandwidth limit exceeded/),
    });
  });
});

function serpResponse(items: unknown[]) {
  return new Response(
    JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] }),
    { status: 200 },
  );
}

describe('rankedKeywords', () => {
  test('normalizes and hits the ranked_keywords endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      // ranked_keywords nests metrics under keyword_data.
      new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [{ keyword: 'seo', keyword_info: { search_volume: 50 } }],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().rankedKeywords({ target: 'x.com' });
    expect(out[0]).toMatchObject({ keyword: 'seo', search_volume: 50 });
    expect(fetchMock.mock.calls[0]![0]).toContain('/dataforseo_labs/google/ranked_keywords/live');
  });

  test('unwraps the keyword_data nesting this endpoint alone uses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      labsResponse([
        {
          keyword_data: {
            keyword: 'membrane fouling',
            keyword_info: { search_volume: 70, cpc: 3, categories: [100, 200] },
            keyword_properties: {
              keyword_difficulty: 12,
              core_keyword: 'reverse osmosis membrane fouling',
            },
          },
          ranked_serp_element: { serp_item: { rank_group: 4 } },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().rankedKeywords({ target: 'x.com' });
    expect(out[0]).toMatchObject({
      keyword: 'membrane fouling',
      core_keyword: 'reverse osmosis membrane fouling',
      category_ids: [100, 200],
      search_volume: 70,
      difficulty: 12,
      cpc: 3,
    });
  });

  test('normalizes a full URL target to a bare domain', async () => {
    const fetchMock = vi.fn().mockResolvedValue(labsResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().rankedKeywords({ target: 'http://competitor.io/pricing' });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual([
      { target: 'competitor.io' },
    ]);
  });
});

describe('keywordSuggestions', () => {
  test('sends a single seed keyword to the keyword_suggestions endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      labsResponse([
        {
          keyword: 'antiscalant dosing rate',
          keyword_info: {
            search_volume: 40,
            cpc: 1.5,
            competition: 0.2,
            search_volume_trend: { yearly: -3 },
            categories: [110, 220],
          },
          keyword_properties: {
            keyword_difficulty: 8,
            core_keyword: 'antiscalant dosing',
          },
          search_intent_info: { main_intent: 'informational' },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().keywordSuggestions({ keyword: 'antiscalant dosing' });
    expect(out[0]).toEqual({
      keyword: 'antiscalant dosing rate',
      core_keyword: 'antiscalant dosing',
      category_ids: [110, 220],
      search_volume: 40,
      difficulty: 8,
      cpc: 1.5,
      competition: 0.2,
      trend: -3,
      intent: 'informational',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/dataforseo_labs/google/keyword_suggestions/live');
    expect(JSON.parse(init.body as string)).toEqual([{ keyword: 'antiscalant dosing' }]);
  });

  test('safely defaults malformed core keyword and category values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        labsResponse([
          {
            keyword: 'antiscalant dosage',
            keyword_info: { categories: [10, 10.5, '11', null, 12] },
            keyword_properties: { core_keyword: '   ' },
          },
          {
            keyword: 'reverse osmosis chemicals',
            keyword_info: { categories: 'not-an-array' },
            keyword_properties: { core_keyword: 42 },
          },
        ]),
      ),
    );

    const out = await client().keywordSuggestions({ keyword: 'antiscalant' });

    expect(out[0]).toMatchObject({ core_keyword: null, category_ids: [10, 12] });
    expect(out[1]).toMatchObject({ core_keyword: null, category_ids: [] });
  });
});

describe('Labs result shaping', () => {
  test('threads limit, order_by and filters into the task payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(labsResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().keywordsForSite({
      target: 'acme.io',
      locationName: 'United States',
      languageName: 'English',
      limit: 500,
      orderBy: ['keyword_info.search_volume,desc'],
      filters: [['keyword_info.search_volume', '>=', 10]],
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual([
      {
        target: 'acme.io',
        location_name: 'United States',
        language_name: 'English',
        limit: 500,
        order_by: ['keyword_info.search_volume,desc'],
        filters: [['keyword_info.search_volume', '>=', 10]],
      },
    ]);
  });

  test('omits order_by and filters when they are absent or empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(labsResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().keywordSuggestions({ keyword: 'seed', orderBy: [], filters: [] });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string)).toEqual([{ keyword: 'seed' }]);
  });
});

describe('keywordIdeas', () => {
  test('sends keywords array to keyword_ideas endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(labsResponse([{ keyword: 'idea one' }]));
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().keywordIdeas({ keywords: ['seed'] });
    expect(out[0]!.keyword).toBe('idea one');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/dataforseo_labs/google/keyword_ideas/live');
    expect(JSON.parse(init.body as string)).toEqual([{ keywords: ['seed'] }]);
  });
});

describe('bulkKeywordDifficulty', () => {
  test('reads difficulty off the item directly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(labsResponse([{ keyword: 'seo tools', keyword_difficulty: 42 }]));
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().bulkKeywordDifficulty({ keywords: ['seo tools'] });
    expect(out[0]).toMatchObject({ keyword: 'seo tools', difficulty: 42 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/dataforseo_labs/google/bulk_keyword_difficulty/live');
    expect(JSON.parse(init.body as string)).toEqual([{ keywords: ['seo tools'] }]);
  });
});

describe('serpGoogleOrganic', () => {
  test('normalizes organic results and skips non-organic items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        serpResponse([
          {
            type: 'organic',
            rank_absolute: 1,
            url: 'https://a.com/x',
            domain: 'a.com',
            title: 'A',
          },
          { type: 'paid', rank_absolute: 2, url: 'https://ad.com', domain: 'ad.com', title: 'Ad' },
          {
            type: 'organic',
            rank_absolute: 3,
            url: 'https://b.com/y',
            domain: 'b.com',
            title: 'B',
          },
        ]),
      ),
    );
    const out = await client().serpGoogleOrganic({ keyword: 'seo tools' });
    expect(out).toEqual([
      { rank: 1, url: 'https://a.com/x', domain: 'a.com', title: 'A' },
      { rank: 3, url: 'https://b.com/y', domain: 'b.com', title: 'B' },
    ]);
  });

  // The prod incident (#241 follow-up): a live SERP call came back HTTP 200 with
  // task status_code 40101 "Internal SE Server Error." — Google, not us. It was
  // categorized as auth, so the retry loop was skipped and the strategy run died.
  test('retries a task-level 40101 (Internal SE Server Error) and succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status_code: 20000,
            tasks: [{ status_code: 40101, status_message: 'Internal SE Server Error.' }],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        serpResponse([
          { type: 'organic', rank_absolute: 1, url: 'https://a.com', domain: 'a.com', title: 'A' },
        ]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().serpGoogleOrganic({ keyword: 'seo tools' });

    expect(out).toEqual([{ rank: 1, url: 'https://a.com', domain: 'a.com', title: 'A' }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 40102 is DataForSEO reporting the SERP was empty, not a failure. Throwing on
  // it would fail a strategy run over a long-tail keyword nobody searches.
  test('returns an empty SERP for a task-level 40102 (No Search Results)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [{ status_code: 40102, status_message: 'No Search Results.' }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client().serpGoogleOrganic({ keyword: 'zzz nobody searches this' }),
    ).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // DataForSEO mirrors task errors in the HTTP status too (see the client's
  // !res.ok branch), so a 40102 arriving as a non-200 is the same non-failure.
  test('returns an empty SERP for a 40102 delivered as a non-200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status_code: 40102,
            status_message: 'No Search Results.',
            tasks: [{ status_code: 40102, status_message: 'No Search Results.' }],
          }),
          { status: 404 },
        ),
      ),
    );
    await expect(client().serpGoogleOrganic({ keyword: 'zzz' })).resolves.toEqual([]);
  });

  test('posts to the SERP live advanced endpoint with the keyword', async () => {
    const fetchMock = vi.fn().mockResolvedValue(serpResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().serpGoogleOrganic({ keyword: 'seo tools' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/serp/google/organic/live/advanced');
    expect(JSON.parse(init.body as string)).toEqual([{ keyword: 'seo tools' }]);
  });
});

describe('backlinksSummary', () => {
  // The backlinks summary endpoint returns fields directly on result[0] — no items[] nesting.
  function summaryResponse(result: unknown[]) {
    return new Response(
      JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  test('extracts rank from result[0]', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(summaryResponse([{ target: 'example.com', rank: 423, backlinks: 12 }]));
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().backlinksSummary('example.com');

    expect(out).toEqual({ rank: 423 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/backlinks/summary/live');
    expect(JSON.parse(init.body as string)).toEqual([{ target: 'example.com' }]);
  });

  test('nulls a missing rank', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse([{ target: 'x' }])));
    expect(await client().backlinksSummary('x')).toEqual({ rank: null });
  });

  test('nulls rank on an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse([])));
    expect(await client().backlinksSummary('x')).toEqual({ rank: null });
  });
});

describe('domainRatingFromRank', () => {
  test('normalizes 0–1000 rank to a 0–100 rating', () => {
    expect(domainRatingFromRank(423)).toBe(42);
    expect(domainRatingFromRank(0)).toBe(0);
    expect(domainRatingFromRank(1000)).toBe(100);
  });

  test('clamps out-of-range values', () => {
    expect(domainRatingFromRank(1200)).toBe(100);
    expect(domainRatingFromRank(-5)).toBe(0);
  });

  test('passes null through', () => {
    expect(domainRatingFromRank(null)).toBeNull();
  });
});
