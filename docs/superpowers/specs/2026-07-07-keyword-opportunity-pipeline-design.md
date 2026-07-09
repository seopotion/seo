# Keyword opportunity scoring + SERP validation (#54)

**Date:** 2026-07-07
**Issue:** [#54](https://github.com/seopotion/seo/issues/54) — child of epic [#56](https://github.com/seopotion/seo/issues/56)
**Depends on:** [#49](https://github.com/seopotion/seo/issues/49) (DataForSEO client + candidate pool), [#52](https://github.com/seopotion/seo/issues/52) (LLM client). Both land on stacked branches not yet in `dev`; this work stacks on `faruk/llm-image-provider-clients`.

## Goal

Build the processing pipeline that converts DataForSEO results into ranked, validated,
classified content opportunities. It gathers candidate keywords, cleans and clusters them,
scores their opportunity, validates the best against live SERPs, and classifies the
survivors into constrained article types.

## Scope boundary

**In scope (#54):** a new `@shared/keywords` package exporting one pure function,
`runKeywordPipeline(input)`; two nullable columns on the candidate schema
(`article_type`, `rejection_reason`) plus their enums; unit tests with fake providers.

**Out of scope (later issues):**

- The strategy job / worker that fetches org context, calls the pipeline, and persists
  results — **#47**.
- Manual-research HTTP routes — **#50**.
- Any SQS/HTTP/DB wiring. The pipeline reads no database and injects all I/O.
- Domain Rating (SERP authority uses a static domain list until DR lands in **#12**).

## Architecture

A single pure function in a new shared package:

```
packages/shared/keywords/
  package.json          // name: @shared/keywords, exports ./src/index.ts
  tsconfig.json
  src/
    index.ts            // exports runKeywordPipeline + public types
    pipeline.ts         // orchestration (the fixed stage order)
    gather.ts           // stage 1: provider fan-out + seed generation
    normalize.ts        // stage 2: dedupe
    filters.ts          // stage 3 + 6: brand/nav filter, difficulty ceiling
    cluster.ts          // stage 4: deterministic near-dup clustering
    score.ts            // stage 8: opportunity score
    serp.ts             // stage 10: SERP validation (authority, duplicate, LLM judgment)
    classify.ts         // stage 11: article-type classification
    llm-prompts.ts      // seed / relevance / SERP-judgment / classify prompt builders + parsers
    config.ts           // defaults for PipelineConfig
    types.ts            // PipelineInput, PipelineResult, EnrichedCandidate
  tests/
    *.test.ts
```

Exports TS source (`exports: { ".": "./src/index.ts" }`); internal deps (`@shared/schemas`,
`@shared/providers`) use `"*"`, per monorepo convention. Bundled into consuming Lambdas by
esbuild like the other `@shared/*`.

**Pure in/out.** The pipeline takes injected clients + org context + the org's existing
content, and returns enriched candidate records. The consumer (#47/#50) fetches existing
content, calls the pipeline, and persists via `CandidateRepo`. This keeps the library
DB-free and makes determinism trivially testable.

### `PipelineInput`

```ts
interface PipelineInput {
  orgId: string;
  websiteUrl: string;
  presets: SetupPresets;                 // business/audience/blog metadata (seed + relevance context)
  competitors: string[];                 // competitor domains (from presets.audience.competitors)
  existingKeywords: string[];            // normalized — org's scheduled keywords  (cannibalization)
  existingArticleKeywords: string[];     // normalized — published-article keywords (cannibalization)
  clients: { dataForSeo: DataForSeoClient; llm: LlmClient };
  config?: Partial<PipelineConfig>;
}
```

### `PipelineConfig` (defaults in `config.ts`)

```ts
interface PipelineConfig {
  difficultyCeiling: number;      // 45  (issue-mandated)
  serpTopN: number;               // e.g. 20 — how many top-ranked candidates get SERP validation
  serpDepth: number;              // e.g. 20 — organic results fetched per SERP
  volumeCap: number;              // 10000 — log-normalization cap for search volume
  authorityDomains: string[];     // wikipedia.org, amazon.com, reddit.com, youtube.com, ...
  authorityThreshold: number;     // e.g. 0.5 — fraction of top SERP domains that are authority ⇒ reject
  serpTopK: number;               // e.g. 10 — how many SERP results the authority/duplicate checks read
  duplicateSerpOverlap: number;   // e.g. 0.6 — top-K URL overlap with an accepted SERP ⇒ duplicate reject
  weights: {                      // opportunity-score weights (sum ≈ 1.0)
    relevance: 0.35; volume: 0.30; ease: 0.20; trend: 0.10; cannibalization: 0.05;
  };
  locationName?: string;          // from presets.business.country
  languageName?: string;          // from presets.business.language
  endpointLimits: {               // per-endpoint `limit` for gather calls
    keywordsForSite: number; rankedKeywords: number; keywordIdeas: number;
  };
}
```

### `EnrichedCandidate` / `PipelineResult`

`EnrichedCandidate` is `CreateCandidateInput` fully populated (scores, intent, `article_type`,
`rejection_reason`, `status`) plus the metrics — exactly what the consumer hands to
`CandidateRepo.insertMany` (the repo derives `normalized_keyword` and assigns timestamps).

```ts
interface PipelineResult {
  candidates: EnrichedCandidate[];   // accepted + below-N scored + all rejected (with reasons)
  stats: {
    gathered: number; afterDedupe: number; afterBrandNav: number; clustered: number;
    afterCeiling: number; scored: number; serpValidated: number; accepted: number;
    rejectedByReason: Record<RejectionReason, number>;
  };
}
```

## Pipeline stages (fixed, deterministic order)

1. **Gather** — fan out provider calls:
   - `keywordsForSite({ target: websiteUrl })` → source `keywords_for_site`.
   - `rankedKeywords({ target: competitor })` for each competitor → source `ranked_keywords`,
     `source_context = competitor`.
   - **Seed generation (LLM):** one `llm.complete` call over business/audience/blog metadata
     returns seed terms → `keywordIdeas({ keywords: seeds })` → source `keyword_ideas`.
   Every gathered `KeywordMetric` is tagged with `source` / `source_context`.
2. **Normalize + dedupe** — `normalizeKeyword`; keep one per normalized key, preferring the
   record with the most non-null metrics (ties broken by normalized key for stability).
3. **Brand/nav filter** (heuristic) — reject if the keyword contains a brand token (org name
   words + registrable domain label from `websiteUrl`) or a navigation token
   (`login`, `sign in`, `contact`, `careers`, `pricing`, `about us`, `download`, …) →
   `brand_navigation`.
4. **Cluster near-dupes** (deterministic) — greedy single-pass clustering over content-token
   sets (stopwords removed), ordered by `search_volume` desc then normalized key. Two
   keywords cluster when Jaccard(token sets) ≥ threshold. Cluster head (first in order)
   survives; members → `clustered_duplicate`.
5. **Fill difficulty** — collect surviving candidates whose `difficulty` is null; one batched
   `bulkKeywordDifficulty({ keywords })` call fills them. Candidates that already have KD are
   skipped (satisfies "batched and skipped when already present").
6. **Difficulty ceiling** — `difficulty > difficultyCeiling` → `difficulty_ceiling`.
   (Null difficulty after fill is treated as unknown and kept — scored with `ease` from a
   neutral midpoint.)
7. **Relevance (LLM)** — one batched `llm.complete` (temp 0, JSON) scores every surviving
   keyword 0–1 for business/audience fit. Missing/invalid entries default to 0.
8. **Opportunity score** — per keyword:
   ```
   volume        = log10(search_volume + 1) / log10(volumeCap)        clamped 0–1  (null ⇒ 0)
   relevance     = LLM relevance                                       0–1
   trend         = clamp(0.5 + trend/2, 0, 1)                          (null ⇒ 0.5 neutral)
   ease          = 1 - clamp(difficulty/100, 0, 1)                     (null ⇒ 0.5 neutral)
   cannibal      = 1 if normalized keyword ∈ existingKeywords ∪ existingArticleKeywords else 0
   opportunity   = 100 * clamp( w.relevance·relevance + w.volume·volume
                              + w.ease·ease + w.trend·trend
                              + w.cannibalization·(1 - cannibal), 0, 1 )
   ```
   Stored on `opportunity_score`; `relevance_score` stores the raw LLM relevance.
9. **Rank + select top-N** — sort by `opportunity_score` desc, then normalized key asc
   (stable tiebreak). The first `serpTopN` go to SERP validation; the rest remain scored
   `candidate` records with no SERP result / `article_type`.
10. **SERP-validate top-N** — for each, in rank order, `serpGoogleOrganic({ keyword, depth })`:
    - **authority** (deterministic): fraction of top-`serpTopK` domains in `authorityDomains`
      ≥ `authorityThreshold` → `serp_authority`.
    - **duplicate-SERP** (deterministic): top-`serpTopK` URL overlap with any already-accepted
      candidate's SERP ≥ `duplicateSerpOverlap` → `serp_duplicate`.
    - **intent + locality (LLM):** one `llm.complete` per candidate passes SERP titles/domains
      + org country/audience; returns `{ intentSuitable, localitySuitable, reason }`. Not
      suitable → `serp_intent` / `serp_locality` (intent checked before locality). Only
      candidates passing all four checks are **accepted** and their SERP recorded for later
      duplicate comparisons.
11. **Classify accepted (LLM)** — one batched `llm.complete` maps each accepted keyword to an
    `article_type` from the constrained enum (falls back to `other` when unsure).
12. **Assemble output** — every candidate becomes an `EnrichedCandidate`:
    - accepted → `status: 'candidate'`, `article_type` set, `rejection_reason: null`;
    - below-top-N scored → `status: 'candidate'`, `article_type: null`, `rejection_reason: null`;
    - rejected at any stage → `status: 'rejected'`, `rejection_reason` set, retaining
      `source`/`source_context` and whatever metrics/scores were computed before rejection.

## Determinism

- No `Date.now`/`Math.random`/`Set`-iteration-order dependence in logic; `created_at`/
  `updated_at` are assigned later by the repo, not the pipeline.
- Every sort has an explicit stable tiebreak (normalized key).
- Given fixed `DataForSeoClient` and `LlmClient` responses, output is byte-identical across
  runs. LLM calls use `temperature: 0` and `responseFormat: 'json'`; parsers tolerate missing
  keys with documented defaults so a fixed response maps to a fixed result.

## Schema changes — `@shared/schemas/src/candidate.ts`

Add two exported enums and two nullable columns (both `.nullable().default(null)`), keeping
`CreateCandidateInput`'s existing omit list:

```ts
export const ARTICLE_TYPES = [
  'how_to_guide', 'listicle', 'comparison', 'definition',
  'product_guide', 'case_study', 'other',
] as const;

export const REJECTION_REASONS = [
  'brand_navigation', 'clustered_duplicate', 'difficulty_ceiling',
  'serp_intent', 'serp_authority', 'serp_locality', 'serp_duplicate',
] as const;

// added to CandidateSchema:
article_type:     z.enum(ARTICLE_TYPES).nullable().default(null),
rejection_reason: z.enum(REJECTION_REASONS).nullable().default(null),
```

Update `candidate.test.ts` for the new fields. No index changes (the
`{ org_id, opportunity_score: -1 }` ranking index already exists from #49).

## Testing (`npm test`, no infra)

Fake in-memory `DataForSeoClient` + `LlmClient` returning fixed responses. Coverage:

- **Scoring** — formula math incl. null-metric neutral defaults, cannibalization on/off,
  clamping, weight application.
- **Filtering** — brand/nav rejection (brand token, domain label, nav word); difficulty
  ceiling boundary (45 keep / 46 reject); null-difficulty kept.
- **Difficulty batching** — `bulkKeywordDifficulty` called only with the missing-KD subset;
  not called when all present.
- **Dedupe** — normalized-key collisions collapse; richer record wins.
- **Clustering** — Jaccard boundary (just-above vs just-below threshold); head selection;
  members marked `clustered_duplicate`.
- **SERP validation** — each rejection reason fires on a crafted SERP (authority threshold
  boundary, duplicate-overlap boundary, LLM intent-fail, LLM locality-fail); top-N limit
  respected (candidate N+1 never triggers `serpGoogleOrganic`).
- **Classification** — each of the seven article types round-trips; unknown ⇒ `other`.
- **Determinism** — same input run twice ⇒ identical `PipelineResult`.
- **Provenance** — every rejected candidate keeps `source`/`source_context` + a
  `rejection_reason`.

## Acceptance criteria (from #54)

- [ ] Pipeline is deterministic for fixed provider responses.
- [ ] Every candidate retains source/provenance and rejection reason.
- [ ] Difficulty lookup is batched and skipped when already present.
- [ ] SERP validation is limited to a configurable top-N range.
- [ ] Article type and search intent use constrained enums.
- [ ] Unit tests cover scoring, filtering, deduplication, and classification boundaries.
