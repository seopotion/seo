# Epic #56 Phase 2 — entitlement seam, manual research (#50), auto strategy (#47)

_Date: 2026-07-08. Part of epic [#56](https://github.com/seopotion/seo/issues/56)._

## Goal

Wire the existing `runKeywordPipeline` (`@shared/keywords`, currently a pure lib with no
consumer) into two paid-gated consumers:

- **#50** — manual keyword-research API for the planner's "Add keyword" flow.
- **#47** — automatic 30-day content strategy, triggered on onboarding completion for
  active paid organizations.

Both depend on #13 (paid entitlement), which is unbuilt. We introduce a **thin
entitlement seam** now so Phase 2 can enforce paid gating; #13 later swaps the seam's
source (a `plan` field) for real Stripe state without touching call sites.

## Confirmed decisions

- Entitlement: thin `plan` field on `Org` + a helper gate now; full Stripe/promo stays in #13.
- Build both #50 and #47, shared substrate first.
- #47 strategy job travels on a **new SQS queue + a second worker Lambda** (isolation from
  fast scans; separate retry/DLQ/observability).
- Planner brief persists **pipeline-available fields + SERP competitors** only. LLM-generated
  angle / target-reader / outline / internal-links are deferred to generation (#55).
- Cluster-spread uses `article_type` as the cluster proxy (true cluster-id surfacing deferred).

## Non-goals (deferred)

- Stripe checkout / webhooks / promo codes (#13).
- LLM briefs / outlines / angles / internal-link suggestions (#55).
- Planner auto-top-up beyond the initial 30 days.
- Surfacing real cluster ids from the pipeline (use `article_type` proxy).
- Frontend surfaces for research / planner (#19 / #48).

---

## Section 1 — Entitlement substrate

**Schema.** In `@shared/types`, add:

```ts
export const ENTITLEMENT_PLANS = ['free', 'trial', 'paid'] as const;
export type EntitlementPlan = (typeof ENTITLEMENT_PLANS)[number];
```

In `OrgSchema` (`@shared/schemas/org.ts`) add `plan: z.enum(ENTITLEMENT_PLANS).default('free')`.
Zod's `default` makes this backward-compatible: orgs stored before this change parse to
`'free'`. `CreateOrgInput` continues to omit nothing new; org creation relies on the default.

**Helper (not middleware).** Add `isPaid(org: Org): boolean` (= `org.plan === 'paid'`) to
`@shared/schemas` (or a small `entitlement.ts`). In the API, add
`loadOwnedPaidOrg(userId: string, orgId: string)` returning a discriminated result:

```ts
type OwnedPaidResult =
  | { ok: true; org: Org }
  | { ok: false; reason: 'not_found' | 'not_owner' | 'not_paid' };
```

Handlers map `not_found → 404`, `not_owner → 403`, `not_paid → 402`. We use a helper rather
than middleware because `org_id` lives in different places per route (json body here) and the
explicit-in-handler style matches the codebase. #13 changes only `isPaid`'s implementation.

Rationale for **402 (Payment Required)** on `not_paid`: distinguishes "you don't own this" from
"upgrade required" so the frontend can route to billing.

---

## Section 2 — Candidate persistence (shared by #50 and #47)

`CandidateRepo.insertMany` already dedups within-batch and against stored candidates. Both
consumers also need to dedup against **scheduled planner keywords** (the `keywords`
collection), so a candidate that's already on the calendar is never re-added.

- Extend `CandidateRepo.insertMany(orgId, items, opts?: { excludeNormalized?: Set<string> })`:
  filter out any item whose `normalized_keyword` is in `excludeNormalized` before the existing
  dedup steps.
- Add `KeywordRepo.scheduledNormalizedSet(orgId): Promise<Set<string>>` — reads scheduled
  keywords, applies `normalizeKeyword`, returns the set.
- Add a thin composition in `@shared/db`, `addCandidates(orgId, items)`:
  `insertMany(orgId, items, { excludeNormalized: await KeywordRepo.scheduledNormalizedSet(orgId) })`.
  Returns the newly inserted candidates. Both the #50 selection handler and the #47 worker use it.

---

## Section 3 — #50 Manual keyword research API

New router `apps/api/src/routes/keywords.ts`: `OpenAPIHono<AuthEnv>`, `authMiddleware`,
`security: [{ Bearer: [] }]`. Mounted at `/keywords` in `routes/index.ts` so it flows into
`AppType` and is typed end-to-end through the client.

A shared response `Metric` schema (`.openapi('KeywordMetric')`): `{ keyword, search_volume,
difficulty, cpc, competition, trend, intent }` (nullable numeric fields), derived from the
provider's `KeywordMetric`.

### `POST /keywords/research`

- Body: `{ org_id: string, seed: string }`.
- `loadOwnedPaidOrg` → 404/403/402 on failure.
- Provider calls (location/language from the org's presets):
  - `dataForSeo.keywordIdeas({ keywords: [seed], limit: 20 })` → `similar` list.
  - `dataForSeo.bulkKeywordDifficulty({ keywords: [seed] })` → the seed's own metrics
    (volume/difficulty). If the seed also appears in `keywordIdeas`, prefer the dedicated call.
- Response `{ seed: Metric, similar: Metric[] }`. `similar` excludes the seed and is bounded
  to the `limit`.
- Provider failure (`DataForSeoError`) → **502**.
- **No persistence.**

### `POST /keywords/candidates`

- Body: `{ org_id: string, keywords: Metric[] }` (the results the user selected).
- `loadOwnedPaidOrg` → 404/403/402.
- Map each to `CreateCandidateInput`: `{ org_id, keyword, source: 'manual', status: 'candidate',
  search_volume, difficulty, cpc, competition, trend, intent }` (scores/article_type left null).
- Persist via `addCandidates` (dedups vs candidates **and** scheduled keywords).
- Response `{ added: number, skipped: number }` (`skipped` = submitted − added). Idempotent:
  re-submitting the same selection adds nothing.

---

## Section 4 — Pipeline change: capture SERP competitors

Today `validateSerp` fetches SERP results but discards them. To persist competitors downstream:

- In `validateSerp`, for each **accepted** candidate, record the top-K organic domains
  (`config.serpTopK`) onto the candidate.
- Add `serp_competitors: string[] | null` (default `null`) to `WorkingCandidate` and
  `EnrichedCandidate` (`@shared/keywords/types.ts`) and to `CandidateSchema` (`@shared/schemas`).
  `pipeline.ts#toEnriched` copies it through.
- Purely additive; the field is `null` for every candidate except SERP-validated accepted ones.

---

## Section 5 — #47 Auto 30-day strategy

### Trigger & idempotency

In `POST /setup/finalize`, after `OrgRepo.finalize(...)`:

- If `isPaid(org)`, atomically claim the strategy via `OrgRepo.claimStrategy(org_id)`:
  a `findOneAndUpdate` that sets `strategy_status: 'pending'` **only** when it is currently
  `'none'` or `'failed'` (i.e. not already `'pending'`/`'completed'`). Returns whether the
  claim was won.
- Only a won claim enqueues `StrategyTask { org_id }` to the strategy queue.

This makes "exactly one job" hold across `finalize` retries and re-finalize: a second call
finds `strategy_status` already `'pending'`/`'completed'` and enqueues nothing.

Add to `OrgSchema`: `strategy_status: z.enum(['none','pending','completed','failed']).default('none')`.

### Transport / infra

- New CDK `StrategyQueue` + `StrategyDeadLetterQueue` in `infra/` `ApiStack`.
- `STRATEGY_QUEUE_URL` env on the API Lambda; grant it `sqs:SendMessage`.
- New task schema `StrategyTask` (`@shared/schemas`): `{ org_id: string }`.
- New API SQS producer `enqueueStrategyTask` (`apps/api/src/clients/sqs.ts`), mirroring
  `enqueueScanTask`, honoring `STRATEGY_QUEUE_URL` (+ `SQS_ENDPOINT` locally).
- Second worker Lambda: `apps/worker` exports `strategyHandler` (new `strategy.ts`), wired to
  the strategy queue as its event source. It needs Mongo + DataForSEO + LLM secrets (**not** JWT).
  Provider secret resolution mirrors the existing SSM/env pattern — **infra task**: provision
  DataForSEO login/password and the OpenRouter key for both the API Lambda (needs DataForSEO for
  #50) and the strategy worker (needs DataForSEO + LLM).
- Local dev: add the strategy worker to `npm run dev` (concurrently) and create the local
  ElasticMQ queue alongside the scan queue.

### Worker logic (`strategyHandler`)

For each record:

1. `StrategyTask.parse(record.body)`; load org + presets.
2. Idempotency guard: if `strategy_status === 'completed'`, log + skip (ack).
3. Build `dataForSeo` + `llm` clients from env.
4. `runKeywordPipeline({ orgId, websiteUrl, presets, competitors, existingKeywords,
   existingArticleKeywords, clients })`, where `competitors` comes from the org's presets,
   `existingKeywords` from `KeywordRepo` (scheduled planner keywords), and
   `existingArticleKeywords` from `ArticleRepo` (already-generated article keywords) — these
   feed the cannibalization filter. On a first strategy run both existing sets are empty.
5. `addCandidates(orgId, result.candidates)` — persist the full enriched set (dedup-safe).
6. **Select top-30**: from candidates with `rejection_reason == null` and non-null
   `search_volume` & `difficulty`, ranked by `opportunity_score` desc (tie-break normalized
   keyword). Take 30. If fewer than 30 qualify, schedule what exists (AC targets "up to 30";
   log the shortfall).
7. **Cluster-spread schedule** (deterministic): group the selected by `article_type`;
   round-robin interleave the groups so adjacent calendar days come from different groups;
   assign day offsets 0..29 from today (date-only `yyyy-mm-dd`).
8. Create planner `keywords` (extended schema — see below) and set each selected candidate's
   `status: 'selected'`.
9. `OrgRepo.setStrategyStatus(org_id, 'completed')`.

On any throw: set `strategy_status: 'failed'`, then rethrow so SQS redelivers → DLQ on repeated
failure. Because the retry sees `'failed'` (not `'completed'`), it re-runs cleanly; step 5's
`addCandidates` and step 8's dedup keep re-runs from duplicating candidates or planner entries.
To keep planner entries idempotent under retry, step 8 skips scheduling any keyword whose
`normalized_keyword` is already scheduled for the org (via `scheduledNormalizedSet`).

### Planner schema extension

Extend `KeywordSchema` (`@shared/schemas/keyword.ts`) with optional, backward-compatible fields
(existing planner reads tolerate them):

- `article_type: z.enum(ARTICLE_TYPES).nullable().default(null)`
- `intent: z.enum(SEARCH_INTENTS).nullable().default(null)`
- `opportunity_score: z.number().nullable().default(null)`
- `serp_competitors: z.array(z.string()).nullable().default(null)`

`search_volume` / `difficulty` remain required ints; the selection filter guarantees non-null
sources, mapped straight through.

---

## Build sequence

- **Phase A** — substrate: entitlement seam (§1), candidate persistence (§2), schema fields
  (`plan`, `strategy_status`, planner extensions, `serp_competitors` on candidate).
- **Phase B** — #50 manual research API (§3).
- **Phase C** — pipeline SERP capture (§4) + #47 trigger, infra, worker (§5).

## Testing

- **§1/§2 (unit + integration):** `isPaid`; `loadOwnedPaidOrg` for each reason;
  `insertMany` `excludeNormalized`; `addCandidates` dedups vs scheduled keywords.
- **§3 (unit, `testClient<AppType>`):** research returns seed + bounded similar; auth required;
  ownership (403) and entitlement (402) enforced; provider failure → 502; selection inserts
  `source: 'manual'` into pool only (never schedules); duplicate selection idempotent.
- **§4 (unit):** accepted candidates carry top-K SERP domains; rejected/below-N carry `null`.
- **§5 (unit + worker):** `finalize` enqueues exactly one job for paid, none for free/trial;
  claim is idempotent across retries/re-finalize; ineligible orgs consume no provider calls;
  worker produces ≤30 uniquely-scheduled entries; clusters distributed (no two adjacent days
  share `article_type` when groups allow); retry/replay never duplicates candidates or planner
  entries; failure sets `strategy_status: 'failed'` and rethrows.

## Acceptance criteria mapping (epic #56)

- Eligible onboarding completion enqueues one idempotent strategy job → §5 trigger.
- Ineligible orgs rejected without provider calls → §1 gate + §5 `isPaid` check pre-enqueue.
- Candidate pool + 30 non-overlapping daily entries → §5 steps 5–8.
- Manual research adds to candidate pool only → §3 selection.
- Job progress / retry / terminal failure observable → `strategy_status` + DLQ.
