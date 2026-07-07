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
