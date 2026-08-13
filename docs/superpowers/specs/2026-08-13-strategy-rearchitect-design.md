# Strategy job rearchitect — Step Functions, 2 LLM calls, construct-don't-validate

**Date:** 2026-08-13 · **Epic:** [#56](https://github.com/seopotion/seo/issues/56) ·
**Trigger:** prod incident 2026-08-13 (org `6a7d6cc57785b8e00b5c9406` in strategy DLQ)

## Context

The strategy job (keyword pipeline → 30-day content plan) runs as one 15-minute
SQS-triggered Lambda. On 2026-08-13 the first prod org failed all three SQS attempts —
each attempt died in a *different* stage (topic clustering validation, DataForSEO
timeout, OpenRouter error) because every retry re-runs the entire pipeline and
re-rolls every provider call. The clustering failure itself is deterministic: the
validator enforces a partition invariant (`primary_index` ∈ `member_indices`) the
prompt never states, at temperature 0 with no retry.

Root design flaws this spec fixes:

1. **LLMs do bookkeeping, not judgment** — the clustering call must emit a perfect
   index partition; a 20-throw-site validator kills the run on any slip.
2. **Failure granularity is the whole job** — no checkpoints; the last stage's failure
   discards all prior provider spend; transient blips consume whole attempts.
3. **No degraded mode** — the deterministic clustering fallback was deleted when the
   LLM version became the sole producer of the plan.
4. **Validation sprawl** — 4 bespoke prompt/parser/validator stacks, plus the worker
   re-validating persisted rows field-by-field (`isPersistedTargetEligible`).

## Goals

- An LLM hiccup can never zero out a customer's plan; total failure requires the same
  stage failing repeatedly.
- A failed stage retries **alone**; completed stages are never re-run or re-billed.
- LLM surface shrinks from 4 prompt/parser/validator stacks to 2.
- Every run's intermediate state is inspectable after the fact (what each LLM saw and
  returned).
- Keep #211's guarantee: never silently ship a degraded/junk plan.

## Non-goals

- Changing what the plan is (≤30 targets, pillar/support ordering, planner semantics).
- Agentic control flow. The stage sequence is fixed; the model never chooses it.
- Multi-org batching, plan top-up scheduling, or any product-visible change.
- Backwards compatibility with the current SQS strategy path (deleted outright).

## Architecture

A **Step Functions Standard state machine** (`StrategyStateMachine`) drives one
stage-router Lambda through a linear sequence:

```
gather → enrich → triage (LLM #1) → serp_fetch → plan (LLM #2) → persist_schedule
```

- **One `StrategyStageFn` Lambda** handles every stage. Each Task state invokes it
  with `{ run_id, org_id, stage }`; a router dispatches to the stage function. One
  bundle (CDK `NodejsFunction`, Style A), per-stage timeouts set on the states.
- **State lives in Mongo, not SFN payloads.** New `strategy_runs` collection; states
  pass only ids. No 256KB payload concerns; full post-hoc inspectability.
- **No SQS.** The strategy queue, DLQ, and `StrategyTask` schema are removed.
  Failure surfacing = CloudWatch alarm on the state machine's `ExecutionsFailed`;
  recovery = **SFN redrive**, which resumes from the failed state — combined with the
  run doc, a redrive re-runs only the broken stage.

### Package layout

- `@shared/keywords` — stays **pure** (no Mongo): stage computation functions, the two
  LLM contracts (prompt builders, Zod output schemas, materializer), scoring,
  scheduling helpers. Signature pattern: `(input, clients, config) → output`.
- `@shared/strategy` — **new package**: run-doc orchestration. Stage router
  (`executeStage(runId, stage)`: read run doc → call the keywords stage fn → write
  output/stats), the launcher, and the in-process sequential runner used by local dev
  and the CLI.
- `@shared/db` — `StrategyRunRepo` (+ `ensureIndexes` entry: `{org_id, created_at}`).
- `apps/worker` — thin Lambda adapter: SFN event → `executeStage`.
- `apps/api` — `/setup/finalize` calls the launcher instead of `sendStrategyTask`.
- `infra` — state machine, EventBridge failure rule, alarm; strategy queue/DLQ removed.

### Launching

`StrategyLauncher.launch(orgId)`:

1. Idempotency guard: skip if `org.strategy_status === 'completed'` (as today).
2. Create a `strategy_runs` doc (`status: 'running'`, input snapshot: presets,
   resolved config, existing scheduled keywords).
3. Deployed (`STRATEGY_STATE_MACHINE_ARN` set): `StartExecution` with
   `{ run_id, org_id }`, execution name `strategy-<run_id>` (unique per run).
   Local (no ARN): run the in-process sequential runner, fire-and-forget with logged
   errors — `npm run dev` and ElasticMQ workflows keep working; Step Functions Local
   is not used.

### The run document

```ts
StrategyRun = {
  id, org_id,
  status: 'running' | 'completed' | 'failed',
  input: { presets, config, existing_keywords: string[] },
  stages: Partial<Record<StageName, {
    status: 'completed' | 'failed',
    started_at, finished_at,
    stats: Record<string, number>,     // per-stage funnel/coverage counters
    error?: string,
  }>>,
  // stage outputs, written by each stage, read by the next:
  candidates?: WorkingCandidate[],     // gather → enrich → triage evolve this
  finalists?: SerpEnrichedCandidate[], // serp_fetch output (with compressed SERP)
  plan?: MaterializedPlan,             // plan output
  created_at, updated_at,
}
```

Zod schema in `@shared/schemas`; repo owns `_id`↔`id` mapping and boundary parsing
per data-layer conventions. Document size is bounded (≤150 finalists with top-5 SERP
summaries — well under Mongo's 16MB).

## Stages

| Stage | Work | Providers | State timeout |
|---|---|---|---|
| `gather` | seed LLM call (as today) → DataForSEO gather → dedupe → brand/nav filter | DataForSEO, LLM | 5 min |
| `enrich` | fill difficulty → difficulty ceiling | DataForSEO | 5 min |
| `triage` | **LLM #1**: batched relevance scoring (today's batching) → score → relevance floor → rank → top-`serpTopN` slice | LLM | 5 min |
| `serp_fetch` | concurrent SERP fetches → deterministic authority filter → compress each SERP to top-5 `{domain, title}` → pairwise overlap evidence | DataForSEO | 8 min |
| `plan` | **LLM #2**: single pass over finalists → verdicts + grouping → materializer builds the plan (below) | LLM | 5 min |
| `persist_schedule` | persist candidates → schedule ≤30 (today's pillar-first logic) → mark org `completed` | Mongo | 5 min |

Notes:

- `triage` keeps the #211 coverage guard (`minLlmCoverage`): below the floor the
  *stage* throws and retries — now costing one stage, not the run.
- `serp_fetch` has **no LLM call**; the intent/locality judge moves into `plan`.
  Authority rejection stays deterministic and happens before any prompt is built.
- `persist_schedule` reuses `stampScheduledDates` / `nextFreeDate` / pillar-first
  cluster ordering and the support-gated-on-confirmed-pillar rule unchanged. The
  20-condition `isPersistedTargetEligible` shrinks to: status is
  `candidate`/`selected`, not rejected, has volume + difficulty. Structures the
  pipeline itself constructed are trusted.
- The worker's `withDeadline` hack is deleted — stage granularity keeps each
  invocation far from the Lambda ceiling (Lambda timeout 10 min ≥ any state timeout).
- Lambda memory stays 512MB. Total execution timeout: 1 hour.

## LLM contract #2 — the `plan` call

**Input** (one call, whole finalist pool, ≤150 candidates): business context (name,
description, audience, language, country) + per-candidate rows
`{ index, keyword, intent, search_volume, difficulty, opportunity_score,
core_keyword?, category_ids?, serp_top: [{domain, title}] }` + the positive pairwise
SERP-overlap evidence (computed as today). Prompt wording is an implementation
concern, but it MUST state every rule the materializer's coverage accounting relies
on, including that omitting a candidate from `targets` means "standalone article",
never "discard".

**Output** — deliberately forgiving, requested via provider-side `json_schema`
(OpenRouter `response_format`) where the model supports it, and always parsed with
Zod (`.catch`/`.default` on non-load-bearing fields):

```json
{
  "verdicts": [
    { "index": 0, "intent_ok": true, "locality_ok": true, "article_type": "guide" }
  ],
  "targets": [
    { "cluster": "notion landing pages", "member_indices": [3, 7, 12],
      "content_focus": "...", "is_pillar": true }
  ]
}
```

There is **no `primary_index` field** and no requirement to cover every index — the
two rules the current validator kills runs over are unrepresentable or true by
construction.

### Materializer (construct, don't validate)

Pure function in `@shared/keywords`, table-driven-tested. All repairs are logged and
counted in stage stats; none throw:

| Model output condition | Materializer action |
|---|---|
| Candidate has no verdict | Excluded from plan, counted as `unjudged` |
| `intent_ok`/`locality_ok` false | Rejected with `serp_intent`/`serp_locality` (as today) |
| `article_type` missing/invalid | `'other'` (as today) |
| Index out of range / not a finalist / rejected by verdict | Dropped from that target |
| Index claimed by an earlier target | First target wins; dropped from later ones |
| Accepted candidate in no target | **Singleton target in its own cluster** |
| Target left with no members after repairs | Target dropped |
| Primary keyword | Highest-`opportunity_score` member (no field to get wrong) |
| Pillar | The unique `is_pillar` target per cluster; zero or >1 → highest-opportunity target in the cluster |
| Cluster identity | Group targets by `cluster` string; id = `topic:<normalized pillar keyword>` (as today) |

**Coverage rule:** if verdicts cover < `minLlmCoverage` of finalists, the *call* is
treated as failed (enters the failure ladder) — a mostly-unjudged pool must not ship
as a mostly-singleton plan (#211).

### Failure ladder (both LLM stages)

1. Provider-enforced JSON schema (where supported).
2. Zod parse fails or coverage below floor → **one repair retry** in-stage, appending
   the actual parse/coverage error to the conversation.
3. Still failing → stage throws typed `StrategyRetryableError` /
   `StrategyFatalError` (mapped from the providers' existing `retryable` flags).
4. SFN `Retry` on `StrategyRetryableError` (and Lambda service errors):
   3 attempts, 30s interval, 2× backoff. Fatal errors fail the execution immediately.
5. Execution fails → org marked `failed`, alarm fires, redrive available.

No fail-open plan is ever shipped. Reaching total failure now requires the same stage
exhausting in-stage and SFN retries — not one imperfect partition.

## Failure model & operations

- **No in-machine `Catch`** — a failed task fails the execution directly so that SFN
  **redrive resumes at the failed state** (a Catch→Fail route would break redrive
  semantics).
- **Org status on failure:** EventBridge rule on `Step Functions Execution Status
  Change` (`FAILED`/`TIMED_OUT`/`ABORTED`) invokes `StrategyStageFn` with a
  `mark_failed` payload (execution input carries `org_id`/`run_id`) → sets
  `org.strategy_status = 'failed'` and stamps the run doc. Existing
  `strategy_status` enum values are unchanged; the FE polling contract is untouched.
- **Alarm:** `ExecutionsFailed ≥ 1` on the state machine, wired like the existing
  DLQ alarms it replaces.
- **Runbook:** inspect the run doc (which stage, what the LLM saw/returned), fix or
  wait, then redrive from the console/CLI. A redrive touches only the failed stage.

## Local dev & testing

- **Local runner** (`@shared/strategy`): sequential `for` loop over stages against
  the same run doc, same failure ladder minus SFN retries. Used by the local
  launcher and the CLI. No new local infra.
- **CLI:** `db strategy-dryrun` is rewired to the stage functions (same
  entry, unchanged UX). Add `db strategy-run <orgId>` to launch/re-run a real run
  locally — this is also the recovery path for the stuck org.
- **Tests (Vitest, existing patterns):**
  - Per-stage unit tests with mocked clients (`vi.mock`), migrated from the current
    pipeline tests.
  - Materializer: table-driven tests covering every repair row above, **including the
    exact prod failure shape** (primary missing from members) and partial-coverage
    responses.
  - Repair-retry ladder: LLM mock fails once with garbage → succeeds on retry with
    the error in context.
  - Local runner end-to-end with all clients mocked: happy path, mid-run resume
    (stage 4 fails → rerun executes only 4–6), idempotent re-launch of a completed
    org.
  - Infra: CDK synth snapshot includes the state machine; no Step Functions Local.

## Deletions

- `packages/shared/keywords/src/topic-clusters.ts` (602 lines) → replaced by the plan
  prompt builder + materializer (~100 lines) + the surviving deterministic
  pillar-first selection logic.
- `packages/shared/keywords/src/classify.ts` and the SERP-judge prompt in
  `llm-prompts.ts` → merged into the plan contract.
- `apps/worker/src/strategy.ts` SQS handler, `withDeadline`, the 20-condition
  re-validation → replaced by the stage router adapter.
- `StrategyTask` schema, strategy queue + DLQ CDK wiring, the API's
  `sendStrategyTask` path.
- `runKeywordPipeline` as a monolith → decomposed into the stage functions.

## Rollout & incident recovery

1. Ships through the normal flow: PR → `dev` → `master` (staging) → GitHub Release
   (prod). Staging verified with a real org end-to-end before release.
2. After prod release: the DLQ (and its one message) disappears with the stack
   change. Re-run the org by launching a fresh run for
   `6a7d6cc57785b8e00b5c9406` — either `aws stepfunctions start-execution` against
   the prod state machine (after creating the run doc via a small launcher CLI
   path), or `db strategy-run` in-process where prod env access is available.
3. `PROGRESS.md` and epic #56 updated; the incident issue (if filed) closed by the PR.

## Risks & mitigations

- **One big plan call degrades grouping quality on large pools** — mitigated by:
  temperature 0, whole-pool context (better than today's blind 25-keyword classify
  batches), compressed SERP evidence, and the dry-run CLI for before/after
  comparison against the clewas benchmark runs.
- **Prompt/token budget:** ≤150 rows × ~40 tokens + SERP top-5 titles ≈ 15–20k input
  tokens, output ≤ ~6k — inside Haiku-class budgets; batch-size constants stay
  configurable via `PipelineConfig`.
- **SFN redrive is per-execution, not per-org** — the runbook and `db strategy-run`
  cover the "start a fresh run" path when a redrive isn't appropriate.
