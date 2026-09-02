# Strategy plan quality on niche orgs, and the day-1 slot

Design for [#292](https://github.com/seopotion/seo/issues/292),
[#293](https://github.com/seopotion/seo/issues/293) and
[#294](https://github.com/seopotion/seo/issues/294), all found on the first
niche org onboarded after #211 (unmarble.com, staging org
`6a96da5c0b0880edc8b02294`, 2026-09-01). Written 2026-09-02.

## What went wrong

The org's 30-day plan came out with 8 entries, 4 of them off-topic (ring and
hair-colour try-on for a clothing product), and the first cron morning produced
two articles. Funnel from the `strategy_runs` doc:

| stage | count |
| --- | --- |
| gathered (all `keyword_suggestions`; `keywords_for_site` 0, competitors empty) | 172 |
| after difficulty ceiling | 156 |
| SERP validated | 150 |
| plan `intent_ok` | 53 |
| plan targets (10 pillars, 0 supports, 43 `topic_duplicate`) | 10 |
| scheduled (2 dropped for `difficulty: null`) | 8 |

Three independent causes, one per issue:

- **#292** — `stagePersistSchedule` starts the plan on the current UTC day. The
  generation cron runs at 07:00 UTC, so any org finalized later that day has a
  day-1 slot already in the past; `listDueForGeneration` (`scheduled_date <=
  today`) then catches day 1 and day 2 up together the next morning.
- **#293** — `relevanceFloor` is 0. The relevance stage scored the junk
  correctly (0.08–0.25 vs 0.75–0.95 on-topic) but nothing downstream acts on
  the score except ranking, so each junk cluster that survived the plan judge
  became its own pillar and scheduled on volume.
- **#294** — the plan call (Haiku) collapsed ~20 accepted on-topic keywords
  into 4 pillar-only targets, rejected the org's head terms ("virtual fitting
  room", 590/mo, KD 21, relevance 0.95) as `intent_ok=false` because their
  SERPs are tool landing pages, and persist dropped 2 targets — including the
  product's core term "outfit combination generator" — for `difficulty: null`.

## Decisions

Validated against a recorded dry-run snapshot of the org
(`db strategy-dryrun --snapshot`, kept outside the repo); every code change is
replayed for free, and a prompt change re-runs only the plan LLM call via
`--allow-live-misses`. A fresh live run on 2026-09-02 reproduced the same
shape (8 pillar-only targets, 0 supports, 3 junk entries), so the snapshot is
representative.

### #292 — start the plan tomorrow

`packages/shared/strategy/src/persist.ts`: `startDay` becomes the next UTC day
(`today + 1 + alreadyScheduled`). The top-up offset and `nextFreeDate` collision
handling are unchanged. The `<= today` catch-up in `listDueForGeneration` is
kept on purpose: a cron day that fails should still be recovered. The only
behaviour change is that day 1 is never scheduled into the past, so the first
article always arrives at the next 07:00 UTC cron, alone.

### #293 — absolute relevance floor

`DEFAULT_CONFIG.relevanceFloor` goes from 0 to about 0.3, the exact value picked
by replay. Constraints: every unmarble candidate at 0.25 or below must be
rejected with `relevance_floor`; piperbox (the other org planned on the current
model; lowest plan entry 0.3) must not lose an entry. The `<=` comparison in
`stageTriage`, the `relevance_floor` rejection reason and the null-score
exemption (unscored ≠ zero, #211) all stay. `strategy-audit` already reports
`by_rejection_reason`, so the cut is visible without new diagnostics.

Rejected alternatives: a pool-relative cut (fraction of p75) is self-referential
— a mostly-junk pool lowers its own bar; a persist-time cut relative to the
best target hides the rejection from the audit histograms and would also drop
piperbox's 0.3 entries.

### #294 — plan stage

1. **Prompt** (`plan-contract.ts`, `buildPlanPrompt`), prompt-only by decision:
   - Intent rule: `intent_ok=false` only when the results are retailer
     listings, a specific other brand's own pages, or transactional pages a
     blog cannot match. Tool or product landing pages in the business's own
     category are winnable competitors for a product company.
   - Support rule: within a cluster, meaningfully different sub-intents (B2B
     vs consumer, technology explainer vs app roundup vs cost) become separate
     support targets; a cluster with several accepted candidates should rarely
     collapse to one target.
   If two prompt iterations still reject the head term, stop and report — no
   code guard is added under this design.
2. **Null difficulty is eligible** at persist: `semanticTargetPool` and
   `isEligibleStoredCandidate` drop the `difficulty !== null` condition.
   Scoring already treats null KD as neutral ease (0.5), so ranking is
   unchanged; `search_volume !== null` stays required.
3. **Audit visibility**: `strategy-audit` diagnostics gain the plan stage's
   `pillars` / `supports` counts from the latest `strategy_runs` doc, so a
   pillar-only regression is visible in one read.

## Acceptance

Replaying the unmarble snapshot with #293 + #294 applied:

- no scheduled entry has relevance below the floor;
- at least one cluster has `supports > 0`;
- "outfit combination generator" is schedulable;
- "virtual fitting room" is accepted by the plan judge.

Plus `npm run lint`, `npm run check:all`, `npm test` on every branch, and the
tests named per change: `persist.test.ts` (start day; null-KD eligibility),
`config.test.ts` (floor), `plan-contract.test.ts` (prompt text), the CLI
`strategy-audit.test.ts` (new diagnostics).

## Delivery

Two PRs into `dev`: #292 alone (persist start day only), and #293 + #294
together (same files, same snapshot, one acceptance replay). Staging
verification is the next real org's plan after `dev` → `master`.

## Follow-ups found by the first live rerun (2026-09-02)

The forced rerun on unmarble after the changes above surfaced three more
gaps. #301 (a rerun never refreshed an earlier run's rejection) shipped the
same day. The other two:

### #303 — top-up dedupes only a target's primary keyword

The plan judge correctly put `virtual try-on` and `virtual try on` in one
target, but the primary came out as the unscheduled variant and
`stagePersistSchedule` only checks `scheduledSet.has(target.keyword)`, so the
top-up scheduled a second article on the same topic. Fix, in `persist.ts`
only: build a member map from the run's candidates (every candidate carrying a
`topic_primary_keyword`, grouped under that primary — the primary plus its
`topic_duplicate` members), and skip a target when **any** member is already
on the planner; a skipped pillar still confirms its cluster so its supports can
schedule. `normalizeKeyword` is left alone — the judge already groups hyphen
variants, and the unique index depends on it.

### #304 — null difficulty is unschedulable below target selection

#294's persist change reached only target selection: `scheduleCandidate`,
`KeywordRepo.createFromCandidate`, both `schedulable` flags (dashboard and
admin) and, structurally, `KeywordSchema.difficulty: z.number().int()` all
require a KD. On unmarble the 7 targets that did not schedule were exactly the
null-KD ones, including the product's core term. Fix: `difficulty` becomes
`int().nullable()` on `KeywordSchema` **and** `ArticleSchema` (finalize copies
the keyword's value into the article), the three gates drop their difficulty
condition (`search_volume` stays required), the API/admin response schemas
follow, and the web/admin surfaces render null as the existing "—" (the
planner's null-aware `formatMetric`; admin's `orEmpty`). Two PRs, #303 first.
