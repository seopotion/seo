import { afterEach, describe, expect, test, vi } from 'vitest';
import { createYouTubeClient } from '../src';

function searchResponse(items: unknown[]) {
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const item = (videoId: string, title = 't', description = 'd', channelTitle = 'c') => ({
  id: { videoId },
  snippet: { title, description, channelTitle },
});

const client = () => createYouTubeClient({ apiKey: 'yt-test', maxRetries: 2, retryDelayMs: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('searchVideos', () => {
  test('sends the expected query params and normalizes items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([item('v1', 'T1', 'D1', 'C1')]));
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().searchVideos('best widgets');

    expect(out).toEqual([{ video_id: 'v1', title: 'T1', description: 'D1', channel: 'C1' }]);
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/search');
    expect(url.searchParams.get('part')).toBe('snippet');
    expect(url.searchParams.get('type')).toBe('video');
    expect(url.searchParams.get('videoEmbeddable')).toBe('true');
    expect(url.searchParams.get('maxResults')).toBe('10');
    expect(url.searchParams.get('q')).toBe('best widgets');
    expect(url.searchParams.get('key')).toBe('yt-test');
    expect(url.searchParams.get('relevanceLanguage')).toBeNull();
  });

  test('passes relevanceLanguage and max when given', async () => {
    const fetchMock = vi.fn().mockResolvedValue(searchResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().searchVideos('x', { max: 5, relevanceLanguage: 'de' });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get('maxResults')).toBe('5');
    expect(url.searchParams.get('relevanceLanguage')).toBe('de');
  });

  test('decodes the HTML entities search.list puts in snippet text', async () => {
    // The API returns titles pre-encoded (`&#39;`, `&amp;`, `&quot;`); the embed
    // builder escapes again, so undecoded titles came out as `&amp;#39;`.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          searchResponse([
            item('v1', 'Here&#39;s A &amp; B &quot;C&quot; &lt;3', 'D &amp; E', 'Tom &amp; Jerry'),
          ]),
        ),
    );
    const out = await client().searchVideos('x');
    expect(out[0]).toEqual({
      video_id: 'v1',
      title: 'Here\'s A & B "C" <3',
      description: 'D & E',
      channel: 'Tom & Jerry',
    });
  });

  test('drops items without a videoId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(searchResponse([item('v1'), { id: {}, snippet: {} }])),
    );
    const out = await client().searchVideos('x');
    expect(out).toHaveLength(1);
    expect(out[0]!.video_id).toBe('v1');
  });

  test('maps 403 (quota/auth) to auth and does NOT retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('quota', { status: 403 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().searchVideos('x')).rejects.toMatchObject({
      name: 'ProviderError',
      category: 'auth',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries on 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(searchResponse([item('v2')]));
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().searchVideos('x');
    expect(out[0]!.video_id).toBe('v2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('HTTP failure carries the status and a body snippet', async () => {
    const body = JSON.stringify({ error: { code: 403, message: 'quotaExceeded' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 403 })));
    await expect(client().searchVideos('x')).rejects.toMatchObject({
      category: 'auth',
      status: 403,
      message: expect.stringMatching(/HTTP 403.*quotaExceeded/),
    });
  });

  test('error messages never contain the API key', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 400 })));
    await expect(client().searchVideos('x')).rejects.toSatisfy(
      (e: Error) => !e.message.includes('yt-test'),
    );
  });
});
