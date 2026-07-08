# Phase 3 — Generate due articles from scheduled planner entries

**Issue:** [#55](https://github.com/seopotion/seo/issues/55) (epic [#56](https://github.com/seopotion/seo/issues/56), Phase 3).
**Scope:** article generation only. Image generation ([#51](https://github.com/seopotion/seo/issues/51))
is deferred to a follow-up; articles store an empty `featured_image_url` until then.
Publishing ([#53](https://github.com/seopotion/seo/issues/53)) is out of scope.

## Goal

Every due planner entry (`keywords` collection) for a **paid** org is turned into exactly one
validated `generated` article, on or after its scheduled date, regardless of any future
auto-publish setting. Generation is idempotent (no duplicate articles under concurrency or
retry), with observable retryable/terminal failure states.

## Confirmed decisions

- **Scope:** #55 only; images deferred to #51. Articles get `featured_image_url = ''`.
- **Trigger:** a daily EventBridge rule → scheduler Lambda that fans out one SQS message per
  due entry → generation worker. (Not a single inline loop — per-article retry/DLQ, no
  long-running batch.)
- **Validation:** deterministic checks **plus** one LLM semantic pass.
- **Entitlement gate** is re-checked in the generation worker (scheduler stays a dumb finder).
- **Invalid drafts are not persisted** as articles — only the failure is recorded on the keyword.
- **Humanization pass** runs on by default (no preset toggle exists yet).
- **Secret wiring** mirrors the existing strategy-worker pattern (`process.env.* ?? ''` from the
  synth host); deployed SSM-SecureString resolution stays deferred, consistent with what ships today.

## Architecture & flow

```
EventBridge daily rule (cron ~07:00 UTC)
  └─> Scheduler Lambda  (apps/worker/src/generation-scheduler.ts)
        finds due entries: scheduled_date <= today (UTC), article_id null,
        generation_status not terminal → enqueues one GenerateTask per keyword
  └─> Generation queue (SQS + DLQ, maxReceiveCount 3)
        └─> Generation worker (apps/worker/src/generation.ts, batchSize 1)
```

This mirrors the existing scan and strategy SQS workers. The scheduler finds work; the worker
does one article per message so retries and DLQ routing are per-article.

### Scheduler Lambda

- Query `keywords` where `scheduled_date <= today` (UTC date string), `article_id: null`, and the
  entry is **not terminal**. Terminal = `generation_status: 'generated'` **or**
  `generation_attempts >= MAX_GENERATION_ATTEMPTS` (a small constant, e.g. 3). A `'failed'` entry
  below the cap is re-enqueued on the next daily run — so within a single day the SQS
  `maxReceiveCount` bounds retries, and across days the persisted attempt cap prevents a genuinely
  bad entry from retrying forever. Past-due entries that never generated are included ("every due
  eligible entry is generated once"), not just today's.
- Enqueue one `GenerateTask { org_id, keyword_id }` per matched entry to the generation queue.
- No entitlement join here — the worker re-checks `isPaid`. Keeps the scheduler a simple finder.

### Generation worker steps

1. `GenerateTask.parse(record.body)` → `{ org_id, keyword_id }`.
2. **Atomic claim** `KeywordRepo.claimGeneration(keyword_id)` — an `updateOne` guarded on
   `{ _id, article_id: null, generation_status ∈ ['pending','failed'] OR ('generating' with
   stale generation_started_at) }` that sets `generation_status: 'generating'`,
   `generation_started_at: now`, and `$inc generation_attempts`. Mirrors `OrgRepo.claimStrategy`.
   Returns a boolean; **no match → already done or in-flight → skip (idempotent).** The stale
   guard reclaims work a crashed worker left in `'generating'`.
3. Load org (**re-check `isPaid`**; if not paid, release the claim back to `'pending'` and skip),
   `org.presets`, and the keyword brief (`keyword`, `article_type`, `intent`, `serp_competitors`,
   `search_volume`, `difficulty`).
4. Run the pipeline (`@shared/generation`): outline → article → humanization → validation.
5. **On pass:** `ArticleRepo.create({ …, status: 'generated', featured_image_url: '' })`, then
   `KeywordRepo.linkArticle(keyword_id, articleId)` which atomically sets `article_id` and
   `generation_status: 'generated'`. Article is created first; the claim already prevents a
   second worker from reaching this step, so there is no double-create.
6. **On failure** (provider error *or* validation failure): record `generation_status: 'failed'`
   + `generation_error` (+ keep `generation_attempts`) on the keyword, then rethrow so SQS
   redelivers. After `maxReceiveCount` (3) the message lands in the DLQ (terminal). Invalid
   content is never persisted as an article and never published.

## Data model changes

### `keywords` (`@shared/schemas/keyword.ts`)

Add generation-lifecycle fields, all optional/defaulted so pre-existing docs still parse:

| Field | Type | Default | Purpose |
| --- | --- | --- | --- |
| `generation_status` | `'pending' \| 'generating' \| 'generated' \| 'failed'` | `'pending'` | claim/lifecycle state |
| `generation_attempts` | `int` | `0` | attempt metadata (observability) |
| `generation_error` | `string \| null` | `null` | last failure reason |
| `generation_started_at` | `date \| null` | `null` | stale-claim reclamation |

`article_id` already exists and remains the linkage of record.

### `articles` (`@shared/schemas/article.ts`)

Add `meta_title` (`string`) — the SERP `<title>`, distinct from `title` (the H1). Existing
`featured_image_url` stays required but is stored as `''` until #51. No other changes; generation
cost/usage is not stored in the baseline (easy to add alongside images later).

### `orgs`

No change. No `auto_publish` field — publishing is #53, and #55 always stores `generated` and
never publishes, which already satisfies "generate regardless of auto_publish".

## `@shared/generation` package (new)

Pure, unit-testable functions, mirroring `@shared/keywords` (thin worker, logic in the package):

- `OutlineSchema` (Zod) + `buildOutlinePrompt(ctx): LlmMessage[]` → outline JSON:
  `{ h1, meta_title, meta_description, slug, sections: [{ heading, intent }], faqs: [...],
  internal_link_opportunities: [...], cta }`.
- `buildArticlePrompt(ctx, outline): LlmMessage[]` → full markdown article.
- `humanize(ctx, markdown): LlmMessage[]` — readability/humanization pass, on by default.
- `validateArticle(markdown, ctx): { ok: boolean; failures: ValidationFailure[] }` — deterministic
  rules (below); `buildSemanticCheckPrompt(...)` + parse for the LLM semantic pass.
- `generateArticle({ org, keyword, presets, llm }): GeneratedArticle` — orchestrates
  outline → article → humanize → validate, returns the draft (+ usage) or throws / returns
  validation failures for the worker to record.

The worker handler (`generation.ts`) stays thin: claim → orchestrate → persist → error-handle,
matching `strategy.ts`.

`ctx` is derived from `org` + `org.presets` + the keyword brief: business name/description,
language, country, target audience, competitors, `article_style`, `internal_links`,
`llm_instructions`, and the keyword's `article_type` / `intent` / `serp_competitors`.

## Validation set

**Deterministic (code):**

- word-count floor (≥ 800 words),
- `title` ≠ `keyword` (case-insensitive),
- `meta_title` length ≤ 60,
- `meta_description` length 120–160,
- exactly one H1 and ≥ 2 H2,
- non-empty intro and conclusion,
- no empty or duplicate section bodies.

**LLM semantic (one JSON call):** unsupported company claims, competitor promotion, natural
keyword usage, and **output language matches `presets.business.language`** → `{ pass: boolean,
reasons: string[] }`. (Language is checked here, not deterministically, to avoid a language-detection
dependency.)

Any failure (deterministic or semantic) marks the run failed, is recorded on the keyword, and does
not produce a published or persisted article.

## Infrastructure (`infra/lib/api-stack.ts`)

- `GenerationQueue` + `GenerationDlq` — visibility timeout ≥ worker timeout; `maxReceiveCount: 3`.
- **Generation worker Lambda** — entry `apps/worker/src/generation.ts`, `SqsEventSource(batchSize: 1)`,
  ~10 min timeout, mongo-uri SSM read grant, env includes `OPENROUTER_API_KEY` (from the synth host,
  same `?? ''` fallback the strategy worker uses). `FAL_KEY` is added later by #51.
- **Scheduler Lambda** — entry `apps/worker/src/generation-scheduler.ts`, plus an EventBridge `Rule`
  on a daily cron (`0 7 * * ? *`) targeting it; `generationQueue.grantSendMessages`, mongo read grant,
  env `GENERATION_QUEUE_URL`.
- Deployed SSM-SecureString resolution for provider keys stays deferred (tracked with #9/#43),
  consistent with the strategy worker already in production.

## Local dev

- `apps/worker/src/dev.ts` gains generation-queue polling (optional, like the strategy queue —
  only polled when `GENERATION_QUEUE_URL` is set).
- The scheduler has no local cron; a small dev script / npm target runs it once on demand to enqueue
  due entries locally.
- Add `OPENROUTER_API_KEY` to `.env.example` if not already present for the worker.

## Testing

**Unit (Vitest, no infra):**

- each deterministic validator rule (pass + fail),
- outline and article prompt builders + outline JSON parse,
- `generateArticle` orchestrator with a mocked `LlmClient`: happy path + one path per validation
  failure category (deterministic and semantic),
- claim idempotency (second claim on a `generating`/`generated` keyword returns false),
- scheduler due-vs-not-due boundary (future date excluded, past/today included; `article_id` set
  excluded; `generated` excluded; `generation_attempts >= MAX_GENERATION_ATTEMPTS` excluded).

**Integration (real Mongo):**

- `claimGeneration` atomicity and `linkArticle` linkage,
- scheduler query returns only due + unlinked + non-terminal entries,
- concurrency: two workers claim the same keyword, exactly one generates.

## Acceptance criteria (from #55)

- [ ] Every due eligible planner entry is generated once — scheduler filter + atomic claim.
- [ ] `auto_publish=false` still produces a stored `generated` article — always stored `generated`.
- [ ] Generated `title` remains distinct from the source keyword — deterministic validator.
- [ ] Validation failures are recorded and do not publish invalid content — failure recorded on
      keyword; no article persisted.
- [ ] Article and keyword linkage is atomic/idempotent — claim + `linkArticle`.
- [ ] Tests cover schedule boundaries, retries, concurrency, and validation failures — see Testing.

## Out of scope / deferred

- Image generation and attachment — #51.
- Publishing to CMS / `auto_publish` behavior — #53.
- Deployed provider-secret SSM resolution — #9 / #43.
- Storing generation cost/usage per article — add with #51.
- A user-facing humanization/readability preset toggle — future.
