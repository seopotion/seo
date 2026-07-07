# DataForSEO client + keyword candidate pool (#49)

**Date:** 2026-07-07
**Issue:** [#49](https://github.com/seopotion/seo/issues/49) — child of epic [#56](https://github.com/seopotion/seo/issues/56)

## Goal

Add the DataForSEO integration and an organization-scoped **candidate keyword pool**,
kept distinct from the existing scheduled `keywords`/planner collection. This is the
provider-independent foundation the rest of the pipeline builds on (#54 scoring/SERP
validation, #47 automatic planning, #50 manual research).

## Scope boundary

**In scope (#49):** a tested DataForSEO HTTP client, a candidate schema + repository
(create / query / update / dedupe), candidate indexes in `ensureIndexes()`, and unit +
integration tests.

**Out of scope (later issues):**

- Scoring, clustering, brand/navigation filtering, SERP-based accept/reject, article-type
  classification — all **#54**.
- HTTP routes / manual-research endpoints — **#50**.
- The strategy job that consumes candidates and schedules planner entries — **#47**.
- Wiring the client into the worker or api (no consumer this session). The client takes
  **injected credentials**; each app resolves its own secrets when it wires the client in.

## Deliverables

### 1. `@shared/providers` package

New workspace package (`packages/shared/providers`) housing server-side external-provider
clients. Named broadly so #52's LLM/image clients can live as siblings later.

```
packages/shared/providers/
  package.json          // name: @shared/providers, exports ./src/index.ts
  tsconfig.json
  src/
    index.ts
    dataforseo/
      client.ts         // createDataForSeoClient(...)
      errors.ts         // DataForSeoError + category enum
      types.ts          // normalized request/response shapes
    tests/
      dataforseo.test.ts
```

Exports TS source (`exports: { ".": "./src/index.ts" }`), internal deps use `"*"`, per
monorepo convention. Bundled into consuming Lambdas by esbuild like the other `@shared/*`.

#### DataForSEO client

`createDataForSeoClient(config)` where
`config = { login: string; password: string; baseUrl?: string; timeoutMs?: number; maxRetries?: number }`.
Returns an object with one method per endpoint:

| Method                 | DataForSEO endpoint                    |
| ---------------------- | -------------------------------------- |
| `keywordsForSite`      | `keywords_for_site/live`               |
| `rankedKeywords`       | `ranked_keywords/live`                 |
| `keywordIdeas`         | `keyword_ideas/live`                   |
| `bulkKeywordDifficulty`| `bulk_keyword_difficulty/live`         |
| `serpGoogleOrganic`    | Google Organic SERP Live Advanced      |

Each keyword method returns a **normalized** array of records (keyword + whatever metrics
that endpoint provides: `search_volume`, `difficulty`, `cpc`, `competition`, `trend`,
`intent`); `serpGoogleOrganic` returns a normalized SERP result list (rank, url, domain,
title). Raw DataForSEO envelopes never leak past the client.

- **Auth:** HTTP Basic `base64(login:password)`, built internally, never logged.
- **Errors:** `DataForSeoError` carrying a `category`:
  `auth | rate_limit | invalid_request | provider | timeout | network`. Normalized and
  **credential-free** (no login/password/URL secrets in message or fields).
- **Timeout/retry:** `AbortController` per request (`timeoutMs`, default 15s). Bounded
  retries (`maxRetries`, default 2) with backoff, **only** on
  `rate_limit` / `provider` (5xx) / `network` / `timeout`. `auth` and `invalid_request`
  fail fast.

### 2. Candidate schema — `@shared/schemas/src/candidate.ts`

```
CandidateSchema = {
  id, org_id
  keyword              // original text
  normalized_keyword   // dedup key: lowercased, trimmed, whitespace-collapsed
  source               // enum: keywords_for_site | ranked_keywords | keyword_ideas | serp | manual | seed
  source_context       // string | null  (e.g. competitor domain / seed term)
  search_volume        // int | null
  difficulty           // int | null (KD)
  cpc                  // number | null
  competition          // number | null (0–1)
  trend                // number | null
  intent               // enum informational|commercial|transactional|navigational | null
  relevance_score      // number | null   (#54 fills)
  opportunity_score    // number | null   (#54 fills)
  status               // enum: candidate | selected | rejected  (default candidate)
  created_at, updated_at
}
```

`CreateCandidateInput` omits `id` / `created_at` / `updated_at` (server-assigned).
Export both schema and `z.infer` type; add to `schemas/src/index.ts`.

**Deferred to #54:** `article_type`, `rejection_reason` (nullable columns added then).

Normalization helper (`normalizeKeyword`) is exported so consumers dedupe consistently.

### 3. `CandidateRepo` — `@shared/db/src/repositories/candidate.repo.ts`

Collection `candidates`. Same conventions as sibling repos: Zod `parse` at the boundary,
`_id` ↔ string `id`, validate on write. Methods:

- `insertMany(orgId, items)` — assigns `normalized_keyword`, dedupes within the org via the
  unique index (skips existing `normalized_keyword`; returns the inserted candidates).
- `listByOrg(orgId, { status? })` — status-filtered query.
- `findByNormalized(orgId, normalized)` — dedup lookups.
- `setStatus(id, status)` — `candidate` → `selected` / `rejected`; bumps `updated_at`.

### 4. Indexes — `ensureIndexes()`

- `candidates { org_id: 1, normalized_keyword: 1 }` **unique** — dedup.
- `candidates { org_id: 1, status: 1 }` — status reads.
- `candidates { org_id: 1, opportunity_score: -1 }` — ranking reads (#54/#47).

## Configuration / secrets

The client resolves nothing itself. Documented env / SSM for when consumers wire it in
(no values committed):

- Local dev / tests: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`.
- Deployed: SSM SecureStrings named by params (e.g. `DATAFORSEO_LOGIN_PARAM`,
  `DATAFORSEO_PASSWORD_PARAM`), resolved per-app via Powertools, mirroring `getJwtSecret()`.

Documented in the issue / `.env.example`; actual wiring lands with #47/#50.

## Testing

- **Unit** (`npm test`, no infra) — mock `fetch`:
  - request shape per endpoint (path, method, body) and Basic auth header present;
  - response normalization per endpoint;
  - error-category mapping: 401→`auth`, 429→`rate_limit`, 400→`invalid_request`,
    5xx→`provider`, aborted→`timeout`, thrown→`network`;
  - retry behavior: retries `rate_limit`/`provider`/`network`/`timeout` up to `maxRetries`,
    does **not** retry `auth`/`invalid_request`;
  - no credential ever appears in a thrown error.
- **Integration** (`npm run test:integration`, real Mongo) — `CandidateRepo`:
  - `beforeAll` runs `ensureIndexes()`; clears `candidates`.
  - `insertMany` dedupes against the unique index (second insert of same normalized key is
    skipped);
  - `listByOrg` status filter;
  - `setStatus` transitions and bumps `updated_at`;
  - cross-org isolation.

## Acceptance criteria (from #49)

- [x] DataForSEO calls isolated behind a tested client.
- [x] Candidates created, queried, updated, deduped per organization.
- [x] Existing scheduled keyword / planner reads remain compatible (separate collection).
- [x] Index creation included in `ensureIndexes()`.
- [x] Provider failures return normalized, non-secret errors.
