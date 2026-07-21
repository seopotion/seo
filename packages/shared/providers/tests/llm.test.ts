import { afterEach, describe, expect, test, vi } from 'vitest';
import { createOpenRouterClient } from '../src';

function chatResponse(content: string) {
  return new Response(
    JSON.stringify({
      model: 'z-ai/glm-5.2',
      choices: [{ message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14, cost: 0.00014 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const client = () => createOpenRouterClient({ apiKey: 'sk-test', maxRetries: 2, retryDelayMs: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('complete', () => {
  test('sends Bearer auth + OpenAI-shaped body and normalizes the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('Hello there!'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().complete({
      messages: [{ role: 'user', content: 'Hi' }],
      maxTokens: 100,
      temperature: 0.7,
    });

    expect(out).toEqual({
      text: 'Hello there!',
      model: 'z-ai/glm-5.2',
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, costUsd: 0.00014 },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'z-ai/glm-5.2',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      temperature: 0.7,
    });
  });

  test('json responseFormat maps to response_format json_object', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await client().complete({ messages: [{ role: 'user', content: 'x' }], responseFormat: 'json' });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  test('honors an explicit model override', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await client().complete({
      messages: [{ role: 'user', content: 'x' }],
      model: 'openai/gpt-5.2',
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).model).toBe('openai/gpt-5.2');
  });

  test('null cost when usage.cost missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: 'm',
            choices: [{ message: { content: 'hi' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200 },
        ),
      ),
    );
    const out = await client().complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(out.usage.costUsd).toBeNull();
  });

  test('maps 401 to auth and does NOT retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client().complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ name: 'ProviderError', category: 'auth' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries on 429 up to maxRetries then throws rate_limit', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('slow', { status: 429 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client().complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ category: 'rate_limit' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('a thrown fetch is categorized network and retried', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client().complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({ category: 'network' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('sends attribution headers when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const attributedClient = createOpenRouterClient({
      apiKey: 'sk-test',
      appReferer: 'https://example.com',
      appTitle: 'SeoPotion',
      maxRetries: 2,
      retryDelayMs: 0,
    });
    await attributedClient.complete({ messages: [{ role: 'user', content: 'x' }] });
    const headers = fetchMock.mock.calls[0]![1].headers as Record<string, string>;
    expect(headers['HTTP-Referer']).toBe('https://example.com');
    expect(headers['X-Title']).toBe('SeoPotion');
  });
});
