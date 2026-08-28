# Article generation on Step Functions

**Date:** 2026-08-28
**Status:** Approved design, pre-implementation

## Problem

Article generation today is EventBridge cron → three chained SQS workers (generation →
images → publish). Two structural problems:

1. **Whole-stage retry re-bills everything.** The generation worker makes ~5 sequential
   LLM calls (outline → body → humanize → semantic, plus YouTube pick) in one SQS
   message. Any failure redelivers the whole message: a finished outline is thrown away
   and re-billed. There is no intra-stage checkpoint and no redrive — after
   `MAX_GENERATION_ATTEMPTS = 3` the keyword is dropped until an admin resets it.
2. **Queue hand-offs fail silently.** `enqueueImageTask` failure is swallowed with a log
   (`apps/worker/src/generation.ts`), leaving articles stuck at
   `images_status: 'pending'` with nothing watching.

Additionally, readability is measured but not enforced: `fleschKincaidGrade` is computed
after generation and only logged (`generation.ts:171-180`). Articles above the target
grade (`FLESCH_KINCAID_TARGET = 8`) publish anyway with no correction loop.

This is the same disease the strategy rearchitect
(`2026-08-13-strategy-rearchitect-design.md`) cured with Step Functions + Mongo
checkpoints. This design applies the same recipe to article generation — not verbatim;
deviations are fine where the article pipeline's shape differs.

## Decisions (from brainstorming)

- **Port generation + images** to one Standard state machine per article.
  **Publish stays on SQS** — it has its own attempt/lease state machine on the article
  doc and a second producer (manual publish from the dashboard).
- **Readability gate** after humanize: on failure, **loop back to humanize only**
  (1 LLM call per iteration) with score feedback — not a body rewrite or full regen.
- **Cap: 2 extra humanize passes** (3 total). On exhaustion, **proceed anyway** with the
  best-scoring attempt, stamping the article with its final grade and
  `target_met: false`. Readability is quality pressure, never a reason a paying customer
  gets no article.
- One execution per due keyword (no Map state); the daily cron scheduler becomes a
  launcher.
- Deviating from the strategy machine's exact shape is acceptable (confirmed by user) —
  the readability Choice-state loop is the main deviation.

## Architecture

### Launch

A shared `launchGeneration` (new module, either `@shared/generation` extension or a
sibling like `@shared/strategy`'s `launch.ts`):

1. Atomically claims the keyword (set `generation_status: 'generating'` only if not
   already generating/generated) — the launch-time idempotency guard, a slimmed
   `claimGeneration` without lease/attempt bookkeeping. Double-launch loses the claim
   and no-ops.
2. Creates an `article_runs` checkpoint doc (status `running`), snapshotting the keyword
   and org presets at launch time.
3. `StartExecution` with name `article-<run_id>` when `ARTICLE_STATE_MACHINE_ARN` is
   set. Naming by `run_id` (not keyword) keeps relaunch-after-failure possible —
   execution names are reserved ~90 days, so a keyword-derived name would block
   regeneration. Falls back to `runLocalGeneration` in-process when the ARN is absent
   (local dev / CLI parity, same trick as `runLocalStrategy`).

Launchers: the daily 07:00 UTC cron scheduler (starts executions instead of enqueuing
SQS), the admin "generate now" route (`apps/api/src/admin/routes/planner.ts`), and CLI
`articles generate-next`.

The generation and images SQS queues, their DLQs, and their event-source mappings
retire. The publish queue is untouched.

### State machine

Standard workflow, all Task states invoking a single `ArticleStageFn` router Lambda with
`{run_id, org_id, stage}`:

```
prepare → outline → draft → humanize → [readability Choice] → finalize
        → images_plan → images_render → handoff_publish
```

- **prepare** — guards (org exists, presets, `isPaid`) as fatal errors; resolve + verify
  link candidates (the HTTP liveness fan-out moves here). Result checkpointed.
- **outline / draft / humanize** — one LLM call each. Each result is checkpointed to the
  run doc via a fenced write (`{'stages.<stage>.status': {$ne: 'completed'}}` filter, as
  in `strategy-run.repo.ts`) so a zombie Lambda past its `taskTimeout` cannot clobber a
  retry's checkpoint. A completed stage short-circuits on re-invocation (idempotent
  against double-fire and redrive).
- **readability Choice** — see below.
- **finalize** — semantic check, `sanitizeLinks` + `validateArticle`, YouTube pick
  (still best-effort try/catch), `ArticleRepo.create` + `KeywordRepo.linkArticle`,
  stamping the persisted `readability` object.
- **images_plan** — the existing 1-LLM-call plan step; set-if-absent semantics move from
  the article doc write into the normal stage checkpoint.
- **images_render** — per-slot loop (cover + 2 inline): fal generate → fetch → S3 →
  `fillImageSlot`. The existing per-slot compare-and-set fills remain the intra-stage
  checkpoint, so a retry resumes at the first empty slot.
- **handoff_publish** — resolve integrations, `initializeAutoPublishAttempt`, enqueue
  one `PublishTask` per provider. As a state, a failed enqueue fails the execution
  (loudly, retryably, redrivably) instead of being a swallowed log.

Per-state `taskTimeout` sized to the step (LLM stages ~5 min, images_render ~8 min);
machine timeout ~1 h.

### Readability gate

- The **humanize stage** computes `fleschKincaidGrade` on its own output, appends
  `{attempt, grade, content_ref}` to `working.humanize_attempts` in the run doc, and
  returns `{readability_ok: boolean}` as state output — the one place a state returns
  data instead of discarding its result (strategy discards all outputs; accepted
  deviation).
- A **Choice state** routes: `readability_ok` → finalize; otherwise back to humanize.
- The humanize stage decides `readability_ok` itself: grade ≤ `FLESCH_KINCAID_TARGET`,
  **or** grade is `null` (too little prose to measure — counts as pass), **or**
  attempts ≥ 3 (initial + 2 retries). On the cap, it selects the **lowest-grade
  attempt** as the winning content before returning `readability_ok: true`.
- Retry prompts include feedback: prior attempt's grade, the target, and an instruction
  to simplify further (building on the existing humanize prompt which already asks for
  grade ≤ 8).
- The article doc gains a persisted `readability` object:
  `{metric: 'flesch_kincaid_grade', grade, target, target_met, attempts}` — today's log
  line becomes data.

### Errors, retry, redrive

- New typed taxonomy: `ArticleRetryableError` / `ArticleFatalError` (mirroring
  `errors.ts` in `@shared/strategy`; seed classification from provider error shapes and
  the publish worker's `normalizePublishingError`). Unknown errors default to
  **retryable** — a retry is cheap at stage granularity.
- Per-state `addRetry` on `[ArticleRetryableError, States.Timeout]`, `maxAttempts: 3`,
  30 s interval, backoff ×2.
- **No Catch states** — a failed execution remains redrivable from the failed state.
- EventBridge rule on `FAILED | TIMED_OUT | ABORTED` re-invokes `ArticleStageFn` with a
  failure-event shape → stamps run + keyword `failed` (mirrors
  `apps/worker/src/strategy.ts`).
- CloudWatch alarm on `metricFailed` replaces DLQ-depth monitoring for these stages.
- `generation_attempts` / `MAX_GENERATION_ATTEMPTS` and `claimGeneration`'s
  lease/attempt bookkeeping retire — SFN per-state retries, the launch-time claim, and
  the run doc replace them. The failure-stamping path resets the claim so a failed
  keyword can be relaunched. (Pre-alpha: no backward-compat shims for in-flight docs.)

### Data

New `article_runs` collection:

- Zod schema in `@shared/schemas`, repository in `@shared/db`, indexes added to
  `ensureIndexes()`.
- Shape (following `strategy_runs`): `id`, `org_id`, `keyword_id`, `status`
  (`running | completed | failed`), `stages` map (per-stage
  `status/attempts/started_at/completed_at/error`), `working` state (snapshot of keyword
  + presets, link candidates, outline, draft, `humanize_attempts[]` with grades, chosen
  content, image plan), timestamps.
- The keyword keeps a slim `generation_status` for the frontend; `articles` gains
  `readability`.

## Not in scope

- Publish flow changes (stays SQS; its attempt machinery is untouched).
- Any readability-review UI; `target_met: false` is data only for now.
- Map-state batch execution; the scheduler starts one execution per keyword.
- Migration of in-flight generation state (pre-alpha, no legacy shims).

## Testing

- Unit (Vitest, mocked providers/`@shared/db`): gate decision logic (loop, cap,
  best-of selection, `null` grade passes), stage router idempotency (completed stage
  short-circuits), fenced-write behavior, error classification.
- `runLocalGeneration` end-to-end with mocked providers, including a
  failing-then-passing readability loop and a resume-past-completed-stages run.
- Existing generation/images worker tests migrate to the stage functions they become.
- Integration: `article_runs` repo against real Mongo (`npm run test:integration`).

## Trade-offs accepted

- The Choice-state loop deviates from strategy's pure-linear, ids-only pattern — chosen
  deliberately so readability retries are visible in execution history and each attempt
  is checkpointed; an in-stage loop would hide them from redrive/observability.
- FK grade is a blunt metric computed by heuristic syllable counting; `null`-grade and
  proceed-on-cap semantics keep it from ever blocking delivery.
- One execution per keyword means N daily executions; at ~10 state transitions each,
  Standard pricing ($0.025/1k transitions) is negligible at current scale.
