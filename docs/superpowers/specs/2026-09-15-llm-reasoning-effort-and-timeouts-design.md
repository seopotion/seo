# LLM reasoning effort and timeout headroom — design

Date: 2026-09-15. Follow-up to `design/ai-model-routing.md` and
[PR #365](https://github.com/seopotion/seo/pull/365) (cheaper, provider-pinned ladder).

## Problem

The 2026-09-15 staging cron run (release [#366](https://github.com/seopotion/seo/pull/366),
`c046c28`) succeeded, but the `technical` org's medium and large stages ran with almost
no headroom under their route timeouts:

| Stage | Model | Stored output | Completion tokens | Duration | Timeout |
| --- | --- | --- | --- | --- | --- |
| outline | deepseek-v4-pro-0813 | 1.3 KB (~350 tokens) | 5,746 | 120.3 s | 120 s |
| draft | qwen3.8-max-0902 | 18 KB (~4.5k tokens) | 7,651 | 201 s | 240 s |

The gap between stored output and completion tokens is hidden reasoning. OpenRouter's
model metadata (checked 2026-09-15): DeepSeek V4 Pro reasons at effort `high` by
default and reasoning is optional; Qwen 3.8 Max reasoning is mandatory and defaults to
`xhigh`. The client sends no `reasoning` parameter, so every medium and large call runs
at the model's heaviest setting. Both Alibaba endpoints list `reasoning` among their
supported parameters.

A timeout today is retried twice inside the Lambda with backoff (the `timeout`
category is retryable), so one slow stage can run three attempts, outlive its 5-minute
Step Functions task, and bill a duplicate call while a second Lambda starts — the
"slow path" the routing spec accepted but asked to watch for.

`general` orgs (all of prod) run every stage on Gemini Flash in 2–14 s and are not
affected; this change must leave them byte-identical.

## Design

### 1. Reasoning effort per route

`LlmRoute` gains an optional `reasoningEffort` (OpenRouter effort string). The ladder
sets `'low'` on the medium and large routes and nothing on the small route.

```ts
export interface LlmRoute {
  model: string;
  provider: string;
  timeoutMs: number;
  /** OpenRouter `reasoning.effort`; omitted = the model's default. */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
}
```

`LlmCompleteParams` gains the same optional field. The client adds
`body.reasoning = { effort }` only when it is set; no other request field changes.
`low` rather than `minimal`: Qwen cannot disable reasoning, and the technical draft is
the one place some thinking is still wanted. The post-deploy staging article decides
whether `low` holds up; lowering further is a one-line ladder change.

### 2. Time budget

| Setting | Now | New |
| --- | --- | --- |
| medium route timeout | 120 s | 180 s |
| large route timeout | 240 s | 300 s |
| Step Functions `draft` task timeout (`infra/lib/api-stack.ts`) | 5 min | 7 min |
| `outline` / `humanize` task timeouts, Lambda timeout | 5 min / 10 min | unchanged |

With `low` effort the measured durations should fall well below the old limits; the
larger numbers are headroom, not the expected case. The draft task grows so one full
large timeout plus checkpoint I/O and a cold start fits inside a single task attempt.
`outline` and `humanize` stay at 5 min, which already holds a 180 s medium call.

### 3. One attempt per timeout in the client

The client's send loop keeps retrying `rate_limit`, `provider` and `network` errors
(2 retries, backoff, unchanged) but makes exactly one attempt when the failure category
is `timeout`. The category itself stays in the retryable set, so `ProviderError.retryable`
is still `true`, the stage still wraps it as `ArticleRetryableError`, and Step Functions
retries the stage with a fresh Lambda (3 attempts, 30 s interval, backoff 2 — unchanged).

Effect: one Lambda invocation is bounded by a single route timeout, and the
overlapping-Lambda duplicate-billing path is gone. The scanner and strategy callers get
the same behaviour; both already sit behind an outer retry (SQS redelivery, Step
Functions), and a request that just spent its full timeout is not a good candidate for
an in-process second try.

### Data flow (unchanged shape)

Stage → `routeLlm(complexity, task)` → `{ model, provider, timeoutMs, reasoningEffort? }`
spread into `llm.complete(...)` → client builds the OpenRouter body → `llm usage` log
line (model, provider, tokens, cost) as today.

## Testing

- `packages/shared/providers/tests/llm-routing.test.ts`: medium and large cells carry
  `reasoningEffort: 'low'`; every `general` cell still equals the client default with no
  `reasoningEffort`; timeout numbers updated (medium 180 000, large 300 000).
- `packages/shared/providers/tests/llm.test.ts`: `body.reasoning` equals
  `{ effort: 'low' }` when the param is set and is absent otherwise; a request that times
  out is thrown after one attempt (fetch called once) with category `timeout` and
  `retryable: true`; a 5xx still retries as before.
- `packages/shared/articles/tests/early-stages.test.ts` and `humanize-stage.test.ts` pin the
  spread route with `objectContaining({ model, timeoutMs })`; update those timeouts and add
  `reasoningEffort: 'low'` to the medium/large expectations.
- Infra has no unit tests; the `infra-synth` CI job covers the task timeout change.
- Staging check after merge: one piperbox article. Read the `llm usage` lines for
  `model`, `provider` and `completion_tokens` (expect outline well under 1k, draft near
  the stored size) and the stage durations against 180 s / 300 s.

## Out of scope

Gemini Flash thinking behaviour, the keyword pipeline's own pinned models, the
`humanize` readability loop, and any change to the SQS-era scanner retry shape.
