import { afterEach, describe, expect, test, vi } from 'vitest';
import { createOpenRouterClient } from '../src';

function chatResponse(content: string) {
  return new Response(
    JSON.stringify({
      model: 'anthropic/claude-haiku-4.5',
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
      model: 'anthropic/claude-haiku-4.5',
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, costUsd: 0.00014 },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'anthropic/claude-haiku-4.5',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      temperature: 0.7,
    });
  });

  // A reasoning model can spend its whole output budget on reasoning tokens and
  // return a 200 with no content. Callers parse JSON out of `text`, so "" is
  // never an answer — it silently degraded a whole pipeline stage (#211).
  test('retries once when the model returns an empty completion', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chatResponse(''))
      .mockResolvedValueOnce(chatResponse('{"types":[]}'));
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().complete({ messages: [{ role: 'user', content: 'x' }] });

    expect(out.text).toBe('{"types":[]}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('gives up after one empty retry and returns the empty result', async () => {
    // A fresh Response per call — a Response body can only be read once.
    const fetchMock = vi.fn(async () => chatResponse('   '));
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().complete({ messages: [{ role: 'user', content: 'x' }] });

    // Returned, not thrown: the callers' own degradation paths still apply.
    expect(out.text).toBe('   ');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('does not retry a response that has content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await client().complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('responseSchema maps to a strict json_schema response_format', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('{}'));
    vi.stubGlobal('fetch', fetchMock);
    const schema = { type: 'object', properties: { a: { type: 'string' } } };
    await client().complete({
      messages: [{ role: 'user', content: 'x' }],
      responseSchema: { name: 'thing', schema },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.response_format).toEqual({
      type: 'json_schema',
      json_schema: { name: 'thing', strict: true, schema },
    });
  });

  test('responseSchema pins routing so the schema cannot be silently dropped', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await client().complete({
      messages: [{ role: 'user', content: 'x' }],
      responseSchema: { name: 'thing', schema: { type: 'object' } },
    });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.provider).toEqual({ require_parameters: true });
  });

  test('omits response_format and provider pinning without a responseSchema', async () => {
    const fetchMock = vi.fn().mockResolvedValue(chatResponse('ok'));
    vi.stubGlobal('fetch', fetchMock);
    await client().complete({ messages: [{ role: 'user', content: 'x' }] });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.response_format).toBeUndefined();
    expect(body.provider).toBeUndefined();
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

  // Regression for the 2026-08-14 staging outage: a 402 "insufficient credits"
  // surfaced as a bare invalid_request with no status or body to diagnose it.
  test('HTTP failure carries the status and a body snippet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: { message: 'This request requires more credits', code: 402 } }),
          { status: 402 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      client().complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      category: 'invalid_request',
      status: 402,
      message: expect.stringMatching(/HTTP 402.*requires more credits/),
    });
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
