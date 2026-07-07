import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDataForSeoClient } from '../src';

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

  test('posts to the SERP live advanced endpoint with the keyword', async () => {
    const fetchMock = vi.fn().mockResolvedValue(serpResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().serpGoogleOrganic({ keyword: 'seo tools' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/serp/google/organic/live/advanced');
    expect(JSON.parse(init.body as string)).toEqual([{ keyword: 'seo tools' }]);
  });
});
