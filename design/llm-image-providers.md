# LLM & Image Providers

**Status:** decided. Resolves issue [#52](https://github.com/seopotion/seo/issues/52)
(Phase 0 of the article-pipeline epic [#56](https://github.com/seopotion/seo/issues/56)).
This doc records the provider decision + rationale and specifies the provider-neutral
client interfaces the generation tasks depend on. Implementing the generation/image
workers themselves is out of scope (Phase 3 — [#55](https://github.com/seopotion/seo/issues/55),
[#51](https://github.com/seopotion/seo/issues/51)).

The clients ship in [`@shared/providers`](../packages/shared/providers) alongside the
existing DataForSEO client and follow the same factory + normalized-error pattern.

## Decision

| Concern | Choice |
| --- | --- |
| LLM provider | **OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`) |
| LLM default model | **`anthropic/claude-haiku-4.5`** — outline, full-article, and humanization passes |
| Image provider | **fal.ai** (`https://fal.run/{model}`) |
| Image default model | **`fal-ai/flux-2`** (FLUX.2 [dev]) — cover/OG + inline images |
| Staging vs prod | One provider account for both; **separate API keys per stage** via per-stage SSM |

Model is a per-call parameter (defaulted from client config), so the models above are
**documented defaults, not hardcoded** — swapping a model is a config change.

The LLM default was originally `z-ai/glm-5.2` and moved to Haiku 4.5. GLM-5.2 is a
reasoning model, and twice spent its entire output budget on reasoning tokens while
returning an empty body ([#211](https://github.com/seopotion/seo/issues/211)); Haiku 4.5
does not reason by default. The keyword pipeline's `plan` stage was already pinned to
Haiku, so this makes one model the default everywhere. Transport, secret, and the
`LlmClient` interface are unchanged — it is a base-model-string change only.

### Why OpenRouter

- Its request/response body is **OpenAI-compatible**. That keeps the neutral `LlmClient`
  mapping trivial and makes a future move to raw OpenAI (or Anthropic direct) a base-URL +
  key change rather than a rewrite — directly serving the "we might ditch this later" goal.
- Single account reaches Claude, GPT, Gemini, etc., so changing the model default needs no
  new integration.
- The response includes a real `usage.cost` (USD), letting us replace cost **estimates**
  with **measured** spend per article.

### Why fal.ai + FLUX.2 [dev]

- Simple synchronous REST (`POST https://fal.run/fal-ai/flux-2`) returns image URLs
  directly — no SDK required, consistent with our fetch-based client style.
- FLUX.2 [dev] is a good quality/cost balance for blog cover and inline imagery — current
  generation, commercially licensed, and ~half the per-megapixel cost of FLUX.1 [dev]
  ($0.012 vs $0.025/MP). `flux-2-pro` (higher quality) and `flux-2-flex` are drop-in
  model-id swaps if the default proves wrong.

## Provider-neutral interfaces

Both live in `@shared/providers`. Consumers (the Phase 3 generation worker) depend on the
**interface**, never the concrete client — so the provider can be replaced by writing a new
factory that returns the same interface.

### `LlmClient`

One method covers all three pipeline uses (outline, full article, humanization) — they
differ only in the messages passed.

```ts
type LlmRole = 'system' | 'user' | 'assistant';
type LlmMessage = { role: LlmRole; content: string };

type LlmCompleteParams = {
  messages: LlmMessage[];
  model?: string;          // defaults to config.defaultModel
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json'; // maps to OpenRouter response_format
};

type LlmUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number | null;  // OpenRouter usage.cost, when reported
};

type LlmResult = {
  text: string;            // choices[0].message.content
  model: string;           // model actually served
  usage: LlmUsage;
};

interface LlmClient {
  complete(params: LlmCompleteParams): Promise<LlmResult>;
}

type LlmConfig = {
  apiKey: string;
  defaultModel?: string;   // default 'anthropic/claude-haiku-4.5'
  baseUrl?: string;        // default 'https://openrouter.ai/api/v1'
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  appReferer?: string;     // optional OpenRouter attribution (HTTP-Referer)
  appTitle?: string;       // optional OpenRouter attribution (X-OpenRouter-Title)
};

function createOpenRouterClient(config: LlmConfig): LlmClient;
```

### `ImageClient`

One method covers cover/OG and inline images.

```ts
type ImageSize = 'square' | 'landscape_16_9' | 'landscape_4_3' | 'portrait_16_9';

type ImageGenerateParams = {
  prompt: string;
  model?: string;          // defaults to config.defaultModel
  size?: ImageSize;        // neutral enum, mapped to fal image_size
  seed?: number;
};

type ImageResult = {
  images: { url: string; width: number | null; height: number | null }[];
  seed: number | null;
};

interface ImageClient {
  generate(params: ImageGenerateParams): Promise<ImageResult>;
}

type ImageConfig = {
  apiKey: string;
  defaultModel?: string;   // default 'fal-ai/flux-2'
  baseUrl?: string;        // default 'https://fal.run'
  timeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
};

function createFalClient(config: ImageConfig): ImageClient;
```

## Normalized errors

The two new clients share a single `ProviderError` with the **same categories** the
DataForSEO client already normalizes to:

```
auth | rate_limit | invalid_request | provider | timeout | network
```

Behavior mirrors `createDataForSeoClient`:

- `categorizeHttpStatus` maps 401/403 → `auth`, 429 → `rate_limit`, ≥500 → `provider`,
  else → `invalid_request`.
- `AbortController` timeout → `timeout`; a thrown fetch → `network`.
- `rate_limit`, `provider`, `network`, `timeout` are **retryable**; the client retries with
  exponential backoff up to `maxRetries`.
- **Credential-free messages** — the API key rides the `Authorization` header only and is
  never included in an error message, `ProviderError` field, or `LlmResult`/`ImageResult`.

The shared categories live in a new `packages/shared/providers/src/errors.ts`. The existing
`dataforseo/errors.ts` is left untouched (it works); unifying it onto the shared module is a
possible later cleanup, not part of this change.

## Configuration & secrets

Two new secrets, **consumed by the worker only** (generation runs in `apps/worker`) — never
the frontend, matching the "only the API Lambda gets the JWT secret" rule.

| Secret | Header | Local (`.env`) | Deployed |
| --- | --- | --- | --- |
| OpenRouter API key | `Authorization: Bearer <key>` | `OPENROUTER_API_KEY` | per-stage SSM SecureString |
| fal.ai API key | `Authorization: Key <key>` | `FAL_KEY` | per-stage SSM SecureString |

- **Local:** plain env vars in the root `.env` (add to `.env.example`), loaded by the worker
  dev entrypoint like the other backend config.
- **Deployed:** resolved from a per-stage SSM SecureString (param name via env, e.g.
  `OPENROUTER_API_KEY_PARAM` / `FAL_KEY_PARAM`), cached — the pattern `getJwtSecret()`
  already uses. One provider account serves both stages; the **key differs per stage** via
  the per-stage param.
- The clients themselves take a plain `{ apiKey }` config and are env-agnostic. **Wiring the
  SSM resolution, worker env, and CDK grant is out of scope for #52** — it belongs to the
  generation issues ([#55](https://github.com/seopotion/seo/issues/55),
  [#51](https://github.com/seopotion/seo/issues/51)). This doc only identifies the
  requirement; no secret values are committed.

## Cost per article (estimate)

Rough per-article estimate; OpenRouter's `usage.cost` and fal's per-image pricing let us
replace these with measured spend once the pipeline runs.

| Step | Model | Rough tokens / count | Est. cost |
| --- | --- | --- | --- |
| Outline | Haiku 4.5 | ~1k in / ~1.5k out | ~$0.01 |
| Full article | Haiku 4.5 | ~2k in / ~5k out | ~$0.03 |
| Humanization pass | Haiku 4.5 | ~5k in / ~5k out | ~$0.03 |
| Images | FLUX.2 [dev] | ~3 images (1 cover + ~2 inline) @ $0.012/MP | $0.04–0.06 |
| **Total** | | | **~$0.11–0.13** |

LLM figures are at Haiku 4.5's $1 / $5 per MTok (in / out); OpenRouter bills close to
that, and the response's `usage.cost` is what actually gets recorded.

Operational limits carried by the clients: per-request timeout (default ~30s for LLM,
longer for image), bounded retries with backoff on retryable categories, and normalized
`rate_limit` surfacing so the worker can back off. Provider content-policy and
data-retention terms are the provider's defaults; no customer PII is sent beyond article
topic/prompt text.

## Acceptance-criteria mapping (#52)

- [x] Selected providers and models documented with rationale — this doc.
- [x] Expected per-article cost and operational limits documented — cost table + limits above.
- [x] Required secrets/configuration identified without committing values — config table.
- [x] Provider-neutral interfaces required by generation tasks specified — `LlmClient` /
      `ImageClient` above.
