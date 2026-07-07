# LLM & Image Provider Clients Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral, unit-tested `LlmClient` (OpenRouter) and `ImageClient` (fal.ai) to `@shared/providers`, with normalized errors, so the Phase 3 generation worker can depend on the interfaces.

**Architecture:** Two new modules (`llm/`, `image/`) inside the existing `@shared/providers` package, mirroring the `dataforseo/` layout (`types.ts` + `client.ts`). A shared `errors.ts` provides one `ProviderError` with normalized categories for both. Each client is a `create*Client(config)` factory returning an interface, using `fetch` + `AbortController` timeout + retry-with-backoff exactly like `createDataForSeoClient`.

**Tech Stack:** TypeScript (bundler resolution, `verbatimModuleSyntax`), Vitest 4, native `fetch`. No new dependencies. Biome for lint/format.

## Global Constraints

- Package: `packages/shared/providers`; exports TS source via barrel `src/index.ts` (`export type` for type-only re-exports — `verbatimModuleSyntax` requires it).
- Tests import the public surface from `../src` (the barrel), matching `tests/dataforseo.test.ts`.
- New shared error names MUST NOT collide with DataForSEO's existing barrel exports (`isRetryable`, `categorizeHttpStatus`, `categorizeApiStatus`, `DataForSeoError`). Use the `*Provider*` names below.
- Credential-free: the API key rides the `Authorization` header only — never in an error message, `ProviderError`, or result object.
- Model is per-call config, defaulted from the client — defaults: LLM `anthropic/claude-sonnet-4.6`, image `fal-ai/flux/dev`.
- Do NOT modify `dataforseo/` — it works and is out of scope.
- Run from repo root. Single test file: `npm test -- providers` (or a filename filter). Gates before "done": `npm run lint`, `npm run check:all`, `npm test`.
- Biome: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new files.
- Spec: [`design/llm-image-providers.md`](../../../design/llm-image-providers.md).

---

## File Structure

- Create: `packages/shared/providers/src/errors.ts` — shared `ProviderError` + category helpers.
- Create: `packages/shared/providers/src/llm/types.ts` — `LlmClient` interface + config/params/result types.
- Create: `packages/shared/providers/src/llm/client.ts` — `createOpenRouterClient`.
- Create: `packages/shared/providers/src/image/types.ts` — `ImageClient` interface + config/params/result types.
- Create: `packages/shared/providers/src/image/client.ts` — `createFalClient`.
- Modify: `packages/shared/providers/src/index.ts` — barrel exports (grown across Tasks 1–3).
- Create: `packages/shared/providers/tests/provider-errors.test.ts`, `tests/llm.test.ts`, `tests/image.test.ts`.
- Modify: `.env.example` — new secret placeholders.
- Modify: `PROGRESS.md` — mark #52 done.

---

## Task 1: Shared normalized errors

**Files:**
- Create: `packages/shared/providers/src/errors.ts`
- Modify: `packages/shared/providers/src/index.ts`
- Test: `packages/shared/providers/tests/provider-errors.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type ProviderErrorCategory = 'auth' | 'rate_limit' | 'invalid_request' | 'provider' | 'timeout' | 'network'`
  - `function isRetryableProviderError(category: ProviderErrorCategory): boolean`
  - `function categorizeProviderHttpStatus(status: number): ProviderErrorCategory`
  - `class ProviderError extends Error { readonly category: ProviderErrorCategory; readonly retryable: boolean }` (`name === 'ProviderError'`)

- [ ] **Step 1: Write the failing test**

Create `packages/shared/providers/tests/provider-errors.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { categorizeProviderHttpStatus, isRetryableProviderError, ProviderError } from '../src';

describe('categorizeProviderHttpStatus', () => {
  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'invalid_request'],
    [404, 'invalid_request'],
    [500, 'provider'],
    [503, 'provider'],
  ])('%i -> %s', (status, expected) => {
    expect(categorizeProviderHttpStatus(status as number)).toBe(expected);
  });
});

describe('isRetryableProviderError', () => {
  test('retries transient categories only', () => {
    expect(isRetryableProviderError('rate_limit')).toBe(true);
    expect(isRetryableProviderError('provider')).toBe(true);
    expect(isRetryableProviderError('network')).toBe(true);
    expect(isRetryableProviderError('timeout')).toBe(true);
    expect(isRetryableProviderError('auth')).toBe(false);
    expect(isRetryableProviderError('invalid_request')).toBe(false);
  });
});

describe('ProviderError', () => {
  test('carries category + retryable and leaks no credentials', () => {
    const err = new ProviderError('auth', 'OpenRouter request failed (auth)');
    expect(err.category).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('ProviderError');
    expect(err.message).not.toMatch(/bearer|authorization|key /i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- provider-errors`
Expected: FAIL — `createOpenRouterClient`/exports not found (module `../src` has no such exports yet).

- [ ] **Step 3: Write the implementation**

Create `packages/shared/providers/src/errors.ts`:

```ts
/** Normalized, credential-free failure categories shared by the LLM and image providers. */
export type ProviderErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'provider'
  | 'timeout'
  | 'network';

const RETRYABLE: ReadonlySet<ProviderErrorCategory> = new Set([
  'rate_limit',
  'provider',
  'network',
  'timeout',
]);

export function isRetryableProviderError(category: ProviderErrorCategory): boolean {
  return RETRYABLE.has(category);
}

/** Map an HTTP response status to a category. */
export function categorizeProviderHttpStatus(status: number): ProviderErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'invalid_request';
}

/**
 * A provider failure. Messages/fields never include the API key or the
 * Authorization header.
 */
export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;

  constructor(category: ProviderErrorCategory, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.category = category;
    this.retryable = isRetryableProviderError(category);
  }
}
```

Then modify `packages/shared/providers/src/index.ts` to add the export (append after the existing dataforseo lines):

```ts
export * from './dataforseo/client';
export * from './dataforseo/errors';
export type * from './dataforseo/types';
export * from './errors';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- provider-errors`
Expected: PASS (3 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/providers/src/errors.ts packages/shared/providers/src/index.ts packages/shared/providers/tests/provider-errors.test.ts
git commit -m "[dashboard] Add shared ProviderError + normalized categories

Part of #52"
```

---

## Task 2: OpenRouter LLM client

**Files:**
- Create: `packages/shared/providers/src/llm/types.ts`
- Create: `packages/shared/providers/src/llm/client.ts`
- Modify: `packages/shared/providers/src/index.ts`
- Test: `packages/shared/providers/tests/llm.test.ts`

**Interfaces:**
- Consumes (from Task 1): `ProviderError`, `categorizeProviderHttpStatus`, `isRetryableProviderError` from `../errors`.
- Produces:
  - `interface LlmClient { complete(params: LlmCompleteParams): Promise<LlmResult> }`
  - `type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string }`
  - `type LlmCompleteParams = { messages: LlmMessage[]; model?: string; maxTokens?: number; temperature?: number; responseFormat?: 'text' | 'json' }`
  - `type LlmResult = { text: string; model: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number; costUsd: number | null } }`
  - `type LlmConfig = { apiKey: string; defaultModel?: string; baseUrl?: string; timeoutMs?: number; maxRetries?: number; retryDelayMs?: number; appReferer?: string; appTitle?: string }`
  - `function createOpenRouterClient(config: LlmConfig): LlmClient`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/providers/tests/llm.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createOpenRouterClient } from '../src';

function chatResponse(content: string) {
  return new Response(
    JSON.stringify({
      model: 'anthropic/claude-sonnet-4.6',
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
      model: 'anthropic/claude-sonnet-4.6',
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14, costUsd: 0.00014 },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'anthropic/claude-sonnet-4.6',
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
    await client().complete({ messages: [{ role: 'user', content: 'x' }], model: 'openai/gpt-5.2' });
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- llm`
Expected: FAIL — `createOpenRouterClient` is not exported.

- [ ] **Step 3: Write the types**

Create `packages/shared/providers/src/llm/types.ts`:

```ts
export type LlmRole = 'system' | 'user' | 'assistant';
export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmCompleteParams {
  messages: LlmMessage[];
  /** Defaults to config.defaultModel. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** 'json' maps to OpenRouter response_format json_object. Default text. */
  responseFormat?: 'text' | 'json';
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** OpenRouter usage.cost (USD) when reported; null otherwise. */
  costUsd: number | null;
}

export interface LlmResult {
  text: string;
  model: string;
  usage: LlmUsage;
}

export interface LlmConfig {
  apiKey: string;
  /** Defaults to 'anthropic/claude-sonnet-4.6'. */
  defaultModel?: string;
  /** Defaults to 'https://openrouter.ai/api/v1'. */
  baseUrl?: string;
  /** Per-request timeout. Default 60000ms. */
  timeoutMs?: number;
  /** Retries on transient errors. Default 2. */
  maxRetries?: number;
  /** Base backoff between retries (ms), doubled each attempt. Default 200. */
  retryDelayMs?: number;
  /** Optional OpenRouter attribution (HTTP-Referer). */
  appReferer?: string;
  /** Optional OpenRouter attribution (X-OpenRouter-Title). */
  appTitle?: string;
}

export interface LlmClient {
  complete(params: LlmCompleteParams): Promise<LlmResult>;
}
```

- [ ] **Step 4: Write the client**

Create `packages/shared/providers/src/llm/client.ts`:

```ts
import { categorizeProviderHttpStatus, isRetryableProviderError, ProviderError } from '../errors';
import type { LlmClient, LlmCompleteParams, LlmConfig, LlmResult } from './types';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.6';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function num(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function createOpenRouterClient(config: LlmConfig): LlmClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.appReferer) headers['HTTP-Referer'] = config.appReferer;
  if (config.appTitle) headers['X-OpenRouter-Title'] = config.appTitle;

  /** One POST to /chat/completions. Handles timeout + maps failures to ProviderError. */
  async function once(body: Record<string, unknown>): Promise<LlmResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderError('timeout', 'OpenRouter request timed out (timeout)');
      }
      throw new ProviderError('network', 'OpenRouter request failed (network)');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const category = categorizeProviderHttpStatus(res.status);
      throw new ProviderError(category, `OpenRouter request failed (${category})`);
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
      };
    };
    const usage = json.usage ?? {};
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      model: json.model ?? defaultModel,
      usage: {
        promptTokens: num(usage.prompt_tokens),
        completionTokens: num(usage.completion_tokens),
        totalTokens: num(usage.total_tokens),
        costUsd: typeof usage.cost === 'number' ? usage.cost : null,
      },
    };
  }

  return {
    async complete(params: LlmCompleteParams): Promise<LlmResult> {
      const body: Record<string, unknown> = {
        model: params.model ?? defaultModel,
        messages: params.messages,
      };
      if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
      if (params.temperature !== undefined) body.temperature = params.temperature;
      if (params.responseFormat === 'json') body.response_format = { type: 'json_object' };

      let attempt = 0;
      // Loop: initial try + up to maxRetries retries on retryable categories.
      for (;;) {
        try {
          return await once(body);
        } catch (err) {
          const retryable = err instanceof ProviderError && isRetryableProviderError(err.category);
          if (!retryable || attempt >= maxRetries) throw err;
          await sleep(retryDelayMs * 2 ** attempt);
          attempt += 1;
        }
      }
    },
  };
}
```

Then add to `packages/shared/providers/src/index.ts`:

```ts
export * from './llm/client';
export type * from './llm/types';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- llm`
Expected: PASS (all 7 tests in `describe('complete')`).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/providers/src/llm packages/shared/providers/src/index.ts packages/shared/providers/tests/llm.test.ts
git commit -m "[dashboard] Add OpenRouter LlmClient behind neutral interface

Part of #52"
```

---

## Task 3: fal.ai image client

**Files:**
- Create: `packages/shared/providers/src/image/types.ts`
- Create: `packages/shared/providers/src/image/client.ts`
- Modify: `packages/shared/providers/src/index.ts`
- Test: `packages/shared/providers/tests/image.test.ts`

**Interfaces:**
- Consumes (from Task 1): `ProviderError`, `categorizeProviderHttpStatus`, `isRetryableProviderError` from `../errors`.
- Produces:
  - `interface ImageClient { generate(params: ImageGenerateParams): Promise<ImageResult> }`
  - `type ImageSize = 'square' | 'landscape_16_9' | 'landscape_4_3' | 'portrait_16_9'`
  - `type ImageGenerateParams = { prompt: string; model?: string; size?: ImageSize; seed?: number }`
  - `type ImageResult = { images: { url: string; width: number | null; height: number | null }[]; seed: number | null }`
  - `type ImageConfig = { apiKey: string; defaultModel?: string; baseUrl?: string; timeoutMs?: number; maxRetries?: number; retryDelayMs?: number }`
  - `function createFalClient(config: ImageConfig): ImageClient`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/providers/tests/image.test.ts`:

```ts
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
      .mockResolvedValue(imageResponse([{ url: 'https://cdn.fal/img.png', width: 1024, height: 768 }]));
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(imageResponse([{ url: 'https://x/y.png' }], 0)));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- image`
Expected: FAIL — `createFalClient` is not exported.

- [ ] **Step 3: Write the types**

Create `packages/shared/providers/src/image/types.ts`:

```ts
/** Neutral aspect/size enum, mapped to the provider's own size param. */
export type ImageSize = 'square' | 'landscape_16_9' | 'landscape_4_3' | 'portrait_16_9';

export interface ImageGenerateParams {
  prompt: string;
  /** Defaults to config.defaultModel. */
  model?: string;
  size?: ImageSize;
  seed?: number;
}

export interface ImageResult {
  images: { url: string; width: number | null; height: number | null }[];
  seed: number | null;
}

export interface ImageConfig {
  apiKey: string;
  /** Defaults to 'fal-ai/flux/dev'. */
  defaultModel?: string;
  /** Defaults to 'https://fal.run'. */
  baseUrl?: string;
  /** Per-request timeout. Default 120000ms (image gen is slow). */
  timeoutMs?: number;
  /** Retries on transient errors. Default 2. */
  maxRetries?: number;
  /** Base backoff between retries (ms), doubled each attempt. Default 500. */
  retryDelayMs?: number;
}

export interface ImageClient {
  generate(params: ImageGenerateParams): Promise<ImageResult>;
}
```

- [ ] **Step 4: Write the client**

Create `packages/shared/providers/src/image/client.ts`:

```ts
import { categorizeProviderHttpStatus, isRetryableProviderError, ProviderError } from '../errors';
import type { ImageClient, ImageConfig, ImageGenerateParams, ImageResult } from './types';

const DEFAULT_BASE_URL = 'https://fal.run';
const DEFAULT_MODEL = 'fal-ai/flux/dev';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function numOrNull(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function createFalClient(config: ImageConfig): ImageClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const headers = {
    Authorization: `Key ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  /** One POST to /{model}. Handles timeout + maps failures to ProviderError. */
  async function once(model: string, body: Record<string, unknown>): Promise<ImageResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/${model}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderError('timeout', 'fal.ai request timed out (timeout)');
      }
      throw new ProviderError('network', 'fal.ai request failed (network)');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const category = categorizeProviderHttpStatus(res.status);
      throw new ProviderError(category, `fal.ai request failed (${category})`);
    }

    const json = (await res.json()) as {
      images?: Array<{ url?: string; width?: number; height?: number }>;
      seed?: number;
    };
    return {
      images: (json.images ?? []).map((img) => ({
        url: String(img.url ?? ''),
        width: numOrNull(img.width),
        height: numOrNull(img.height),
      })),
      seed: numOrNull(json.seed),
    };
  }

  return {
    async generate(params: ImageGenerateParams): Promise<ImageResult> {
      const model = params.model ?? defaultModel;
      const body: Record<string, unknown> = { prompt: params.prompt };
      if (params.size) body.image_size = params.size;
      if (params.seed !== undefined) body.seed = params.seed;

      let attempt = 0;
      // Loop: initial try + up to maxRetries retries on retryable categories.
      for (;;) {
        try {
          return await once(model, body);
        } catch (err) {
          const retryable = err instanceof ProviderError && isRetryableProviderError(err.category);
          if (!retryable || attempt >= maxRetries) throw err;
          await sleep(retryDelayMs * 2 ** attempt);
          attempt += 1;
        }
      }
    },
  };
}
```

Then add to `packages/shared/providers/src/index.ts`:

```ts
export * from './image/client';
export type * from './image/types';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- image`
Expected: PASS (all 5 tests in `describe('generate')`).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/providers/src/image packages/shared/providers/src/index.ts packages/shared/providers/tests/image.test.ts
git commit -m "[dashboard] Add fal.ai ImageClient behind neutral interface

Part of #52"
```

---

## Task 4: Document secrets + close out #52

**Files:**
- Modify: `.env.example`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: nothing (docs only).

- [ ] **Step 1: Add secret placeholders to `.env.example`**

Append to the end of `.env.example` (after the DataForSEO block):

```bash

# OpenRouter (LLM) + fal.ai (image) — read by the worker when generation is wired
# in (epic #56). Local dev: set the plain keys below. Deployed envs leave these
# unset and instead resolve SSM SecureStrings named by *_PARAM (see infra, #55/#51).
OPENROUTER_API_KEY=
FAL_KEY=
# OPENROUTER_API_KEY_PARAM=
# FAL_KEY_PARAM=
```

- [ ] **Step 2: Update `PROGRESS.md`**

In `PROGRESS.md`, under the shared-packages line, update the `@shared/providers` entry to note the new clients. Change:

```
- ✅ `@shared/types`, `@shared/schemas` (Zod entity shapes), `@shared/db` (repos + `ensureIndexes`), `@shared/clients` (typed `getApiClient`), `@shared/providers` (DataForSEO client)
```

to:

```
- ✅ `@shared/types`, `@shared/schemas` (Zod entity shapes), `@shared/db` (repos + `ensureIndexes`), `@shared/clients` (typed `getApiClient`), `@shared/providers` (DataForSEO + OpenRouter LLM + fal.ai image clients)
```

And under the epic bullets in "Dashboard", add one line after the keyword-research foundation entry (line ~45):

```
- ✅ LLM (OpenRouter/Claude Sonnet) + image (fal.ai/FLUX.1 dev) provider decision + neutral `LlmClient`/`ImageClient` clients — [#52](https://github.com/seopotion/seo/issues/52); worker wiring pending — [#55](https://github.com/seopotion/seo/issues/55), [#51](https://github.com/seopotion/seo/issues/51)
```

- [ ] **Step 3: Run the full gates**

Run: `npm run lint`
Expected: no errors (run `npm run lint:fix` first if formatting differs).

Run: `npm run check:all`
Expected: typecheck passes (root + web).

Run: `npm test`
Expected: all provider tests + existing suite green.

- [ ] **Step 4: Commit**

```bash
git add .env.example PROGRESS.md
git commit -m "[dashboard] Document LLM/image secrets; mark #52 done in PROGRESS

Part of #52"
```

---

## Self-Review

**Spec coverage** (`design/llm-image-providers.md`):
- Decision table (providers/models/staging) → recorded in the design doc (committed in brainstorming).
- `LlmClient` interface → Task 2. `ImageClient` interface → Task 3.
- Normalized errors → Task 1 (shared `ProviderError` + categories, reused by Tasks 2–3).
- Credential-free messages → asserted in Tasks 1–3 tests (message + result never contain the key).
- Config & secrets → Task 4 (`.env.example`); SSM/worker/CDK wiring explicitly deferred to #55/#51 per spec.
- Cost per article → recorded in the design doc (documentation deliverable, no code).
- Acceptance criteria mapping → satisfied: providers/models documented, cost/limits documented, secrets identified without values, neutral interfaces specified + implemented.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows full test bodies.

**Type consistency:** `ProviderError` / `categorizeProviderHttpStatus` / `isRetryableProviderError` defined in Task 1 and consumed verbatim in Tasks 2–3. `LlmClient.complete` / `ImageClient.generate` names match between the Interfaces blocks, the type files, and the tests. Barrel export names (`createOpenRouterClient`, `createFalClient`) match the test imports. New error names avoid collision with the existing DataForSEO barrel exports.
