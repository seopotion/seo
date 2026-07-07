import { afterEach, describe, expect, test, vi } from 'vitest';
import { createFalClient } from '../src';

function imageResponse(images: unknown[], seed = 123) {
  return new Response(JSON.stringify({ images, seed }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

const client = () => createFalClient({ apiKey: 'fal-test', maxRetries: 2, retryDelayMs: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('generate', () => {
  test('sends Key auth to the model endpoint + normalizes images', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        imageResponse([{ url: 'https://cdn.fal/img.png', width: 1024, height: 768 }]),
      );
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().generate({ prompt: 'a cat', size: 'landscape_16_9' });

    expect(out).toEqual({
      images: [{ url: 'https://cdn.fal/img.png', width: 1024, height: 768 }],
      seed: 123,
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://fal.run/fal-ai/flux/dev');
    expect((init.headers as Record<string, string>).Authorization).toBe('Key fal-test');
    expect(JSON.parse(init.body as string)).toEqual({
      prompt: 'a cat',
      image_size: 'landscape_16_9',
    });
  });

  test('honors an explicit model override in the URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(imageResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().generate({ prompt: 'x', model: 'fal-ai/flux/schnell' });
    expect(fetchMock.mock.calls[0]![0]).toBe('https://fal.run/fal-ai/flux/schnell');
  });

  test('nulls missing image dimensions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(imageResponse([{ url: 'https://x/y.png' }], 0)),
    );
    const out = await client().generate({ prompt: 'x' });
    expect(out.images[0]).toEqual({ url: 'https://x/y.png', width: null, height: null });
  });

  test('maps 401 to auth and does NOT retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().generate({ prompt: 'x' })).rejects.toMatchObject({
      name: 'ProviderError',
      category: 'auth',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries on 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(imageResponse([{ url: 'https://ok/1.png', width: 512, height: 512 }]));
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().generate({ prompt: 'x' });
    expect(out.images[0]!.url).toBe('https://ok/1.png');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
