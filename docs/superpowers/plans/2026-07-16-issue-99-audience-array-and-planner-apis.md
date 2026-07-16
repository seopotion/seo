# Issue #99: Audience Array + Candidate-Pool / Planner Scheduling APIs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement both change requests in issue #99: (A) `presets.audience.target` becomes `string[]` end-to-end with an idempotent Mongo migration; (B) candidate-pool read + manual planner scheduling/rescheduling/removal APIs with DB-enforced invariants.

**Architecture:** Part A changes the shared Zod schema with a legacy-string coercion (`z.preprocess`) so old documents keep parsing regardless of migration ordering, joins the array with `', '` at the two LLM-prompt consumers, and adds a `db migrate` CLI command. Part B adds unique indexes (org/date, org/normalized_keyword, org/candidate_id) as the concurrency backstop, conditional-update repo methods, a shared `scheduleCandidate` service used by both the API and the strategy worker, and four new OpenAPI routes on the keywords router. No Mongo transactions (local/standalone Mongo has none) — conditional updates + unique indexes + idempotent reconciliation instead.

**Tech Stack:** TypeScript 6, zod 4, `@hono/zod-openapi` 1, mongodb 7, Vitest 4, citty CLI.

## Global Constraints

- Branch workflow: Part A on `ozykhan/audience-target-array` off `dev`; Part B on `ozykhan/planner-scheduling-apis` off Part A's branch (stacked PR). PRs into `dev`, bodies carry `Part of #99` (Part A) and `Closes #99` (Part B).
- `OpenAPIHono` everywhere; every schema `.openapi('Name')`; routers stay chained so `AppType` captures endpoints.
- Repositories own driver access; routes never touch Mongo directly.
- `import type` for type-only imports (`verbatimModuleSyntax`).
- Biome: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new code.
- Error contract (Part B): stable machine strings `not_paid`, `date_occupied`, `keyword_already_scheduled`, `candidate_already_scheduled`, `candidate_not_schedulable`, `generation_started`, `not_found` in `{ "error": "<code>" }` bodies.
- New Part B endpoints use **404** for missing-or-not-owned (loadOwnedOrg convention); existing research/candidates routes keep their 403 `not_owner` (surgical — do not change existing contract).
- Do not split legacy audience strings on commas: non-empty string → `[string]`, empty → `[]`.
- Verification before completion: `npm run lint`, `npm run check:all`, `npm test`, and `docker compose up -d mongo && npm run test:integration`.

---

# Part A — `audience.target: string[]`

### Task A1: Schema change with legacy coercion

**Files:**
- Modify: `packages/shared/schemas/src/presets.ts:14-17`
- Test: `packages/shared/schemas/tests/presets.test.ts` (new)

**Interfaces:**
- Produces: `SetupPresetsSchema.shape.audience.shape.target` parses `string[]` (max 7) and coerces legacy `string` input (`'' → []`, `'x' → ['x']`). `SetupPresets['audience']['target']` is `string[]`.

- [ ] **Step 1: Write failing tests** — new file `packages/shared/schemas/tests/presets.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { SetupPresetsSchema } from '../src/presets';

const base = {
  business: { name: 'n', language: 'English', country: 'United States', description: 'd' },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: 's', internal_links: true, llm_instructions: '' },
    engagement: { image_style: 'i' },
  },
};

describe('SetupPresetsSchema audience.target', () => {
  test('parses an array of strings', () => {
    const p = SetupPresetsSchema.parse({
      ...base,
      audience: { target: ['a', 'b'], competitors: [] },
    });
    expect(p.audience.target).toEqual(['a', 'b']);
  });

  test('coerces a legacy non-empty string to a single-element array (no comma split)', () => {
    const p = SetupPresetsSchema.parse({
      ...base,
      audience: { target: 'plant operators, and managers', competitors: [] },
    });
    expect(p.audience.target).toEqual(['plant operators, and managers']);
  });

  test('coerces a legacy empty string to an empty array', () => {
    const p = SetupPresetsSchema.parse({ ...base, audience: { target: '', competitors: [] } });
    expect(p.audience.target).toEqual([]);
  });

  test('rejects more than 7 entries', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `a${i}`);
    expect(() =>
      SetupPresetsSchema.parse({ ...base, audience: { target: eight, competitors: [] } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run** `npm test -- presets` → FAIL (target is `z.string()`).
- [ ] **Step 3: Implement** in `presets.ts`:

```ts
  audience: z.object({
    // Array of distinct audience segments (max 7 per design note). The
    // preprocess keeps pre-migration string documents parsing: '' -> [],
    // non-empty -> [string] — never comma-split (strings may contain commas).
    target: z.preprocess(
      (v) => (typeof v === 'string' ? (v === '' ? [] : [v]) : v),
      z.array(z.string()).max(7),
    ),
    competitors: z.array(z.string()),
  }),
```

- [ ] **Step 4: Run** `npm test -- presets` → PASS.
- [ ] **Step 5: Commit** `git commit -m "[backend] audience.target: string -> string[] with legacy coercion (#99)"`

### Task A2: Update producers/consumers + fixtures

**Files:**
- Modify: `apps/worker/src/scanner.ts:28,36` (prompt) — LLM must return an array
- Modify: `packages/shared/generation/src/context.ts:13` — `audience: p.audience.target.join(', ')`
- Modify: `packages/shared/keywords/src/llm-prompts.ts:10` — `Target audience: ${presets.audience.target.join(', ')}`
- Modify: every test fixture using `target: '<string>'` → `target: ['<string>']` in: `apps/api/tests/{merge-presets,dashboard,setup}.test.ts`, `apps/worker/tests/{generation,strategy,images,worker,scanner}.test.ts`, `packages/shared/keywords/tests/*.test.ts`, `packages/shared/generation/tests/*.test.ts`, `apps/cli/tests/db.test.ts` (grep `audience` + `target:`).

**Interfaces:**
- Consumes: Task A1 schema.
- Produces: scanner returns `target: string[]` (`[]` fallback); `GenerationContext.audience` stays `string` (joined).

- [ ] **Step 1:** Scanner prompt lines become:

```ts
    '  "audience": { "target": string[] },',
    ...
    'target is an array of 3-7 short distinct audience segments (never one comma-separated sentence).',
```

- [ ] **Step 2:** In `scanner.ts` the parse call stays `target: fields.audience?.target` (schema coerces); update the type annotation `audience?: { target?: unknown }` — unchanged. Update `scanner.test.ts` expectations to arrays; keep/adjust a test that a string-returning LLM still yields `[target]` (coercion).
- [ ] **Step 3:** Join at the two prompt consumers (exact lines above).
- [ ] **Step 4:** Update all fixtures (`grep -rn "target: '" --include='*.test.ts'`).
- [ ] **Step 5:** `npm test` → PASS. Commit `"[backend] audience.target consumers: scanner emits array, prompts join (#99)"`.

### Task A3: `db migrate` CLI command + migration

**Files:**
- Create: `packages/shared/db/src/migrations.ts`
- Modify: `packages/shared/db/src/index.ts` (export `runMigrations`)
- Modify: `apps/cli/src/lib/db.ts`, `apps/cli/src/commands/db.ts`, `apps/cli/src/types.ts` (new Result data type)
- Test: `packages/shared/db/tests/migrations.integration.test.ts` (new)

**Interfaces:**
- Produces: `runMigrations(): Promise<{ audience_target_migrated: number }>` (Part B extends this report); CLI `npm run cli -- db migrate`.

- [ ] **Step 1: Failing integration test** (pattern of `candidate.repo.integration.test.ts`): seed `orgs` docs with `presets.audience.target` as `'x, y'`, `''`, and `['z']`; run `runMigrations()`; assert `['x, y']`, `[]`, `['z']`; run again → 0 changed (idempotent).
- [ ] **Step 2:** `migrations.ts`:

```ts
import { getDb } from './client';

/**
 * Idempotent data migrations — run via `seo-dev db migrate` BEFORE `db init`
 * on deploy. Each step is a no-op once applied.
 */
export async function runMigrations(): Promise<{ audience_target_migrated: number }> {
  const db = await getDb();
  // #99: presets.audience.target string -> string[] ('' -> [], 'x' -> ['x']).
  // Never comma-split — legacy strings may contain natural-language commas.
  const res = await db.collection('orgs').updateMany(
    { 'presets.audience.target': { $type: 'string' } },
    [
      {
        $set: {
          'presets.audience.target': {
            $cond: [
              { $eq: ['$presets.audience.target', ''] },
              [],
              ['$presets.audience.target'],
            ],
          },
        },
      },
    ],
  );
  return { audience_target_migrated: res.modifiedCount };
}
```

- [ ] **Step 3:** CLI wiring — `apps/cli/src/lib/db.ts` adds `migrateDb()` mirroring `initDb()` (calls `runMigrations`, returns `ok(report)`, same `closeDb` finally); `commands/db.ts` adds a `migrate` subcommand mirroring `init`.
- [ ] **Step 4:** `docker compose up -d mongo && npm run test:integration` → PASS. Unit `apps/cli/tests/db.test.ts` — add a mocked-repo test for `migrateDb` following the file's existing pattern.
- [ ] **Step 5:** Commit `"[backend] add db migrate CLI + audience.target array migration (#99)"`.

### Task A4: API round-trip tests (arrays survive)

**Files:**
- Modify: `apps/api/tests/setup.test.ts`, `apps/api/tests/dashboard.test.ts`

- [ ] **Step 1:** Add to setup tests: PATCH `/setup/presets` with `audience: { target: ['a', 'b'] }` returns the array unchanged; `/setup/details` and `/setup/finalize` responses carry arrays (extend existing tests' fixtures/assertions).
- [ ] **Step 2:** Add to dashboard tests: `PATCH /settings/general` with `audience: { target: ['a'] }` → response `audience.target` is `['a']` and `OrgRepo.updatePresets` received the array (not a joined string).
- [ ] **Step 3:** `npm test`, `npm run lint`, `npm run check:all` (web must pass — onboarding UI already models audiences as an array locally and does not consume the presets API yet). Commit `"[backend] round-trip tests: audience arrays survive details/presets/finalize/settings (#99)"`.

### Task A5: PR for Part A

- [ ] Push branch, open PR into `dev`: title `[backend] audience.target string -> string[] + migration`, body summarizes contract + migration ordering (`db migrate` before deploy; schema coerces legacy strings so ordering can't break parsing), `Part of #99`.

---

# Part B — Candidate pool + manual planner scheduling

### Task B1: `KeywordSchema.candidate_id`

**Files:**
- Modify: `packages/shared/schemas/src/keyword.ts`
- Test: `packages/shared/schemas/tests/keyword.test.ts`

- [ ] Add after `org_id`:

```ts
  // Source candidate linkage (#99); null for legacy/pre-#99 records.
  candidate_id: z.string().nullable().default(null),
```

- [ ] Test: legacy doc without `candidate_id` parses to `null`; `CreateKeywordInput` accepts omitted `candidate_id`.
- [ ] Commit `"[backend] KeywordSchema.candidate_id nullable linkage (#99)"`.

### Task B2: Indexes + Part B migrations

**Files:**
- Modify: `packages/shared/db/src/ensure-indexes.ts`
- Modify: `packages/shared/db/src/migrations.ts`
- Test: `packages/shared/db/tests/migrations.integration.test.ts`, new assertions in `keyword.repo.integration.test.ts`

**Interfaces:**
- Produces: unique `{org_id,scheduled_date}`; unique partial `{org_id,normalized_keyword}` (`normalized_keyword: {$type:'string'}`); unique partial `{org_id,candidate_id}` (`candidate_id: {$type:'string'}`); candidates index `{org_id,status,opportunity_score:-1,created_at:1}`. Migration report gains `normalized_backfilled`, `date_dupes_resolved`, `keyword_dupes_removed`.

- [ ] **Step 1: ensure-indexes** — replace the keywords block:

```ts
  // One planner entry per org per day (#99) — final concurrency backstop.
  // The pre-#99 index had the same name without `unique`; drop-and-recreate
  // on options conflict (code 85). Run `db migrate` first to resolve dupes.
  try {
    await db
      .collection('keywords')
      .createIndex({ org_id: 1, scheduled_date: 1 }, { unique: true });
  } catch (e) {
    if ((e as { code?: number }).code !== 85) throw e;
    await db.collection('keywords').dropIndex('org_id_1_scheduled_date_1');
    await db
      .collection('keywords')
      .createIndex({ org_id: 1, scheduled_date: 1 }, { unique: true });
  }
  // One scheduled entry per normalized keyword per org (#99); partial so
  // legacy docs without the field don't block creation.
  await db.collection('keywords').createIndex(
    { org_id: 1, normalized_keyword: 1 },
    { unique: true, partialFilterExpression: { normalized_keyword: { $type: 'string' } } },
  );
  // One planner entry per source candidate (#99) — makes scheduling idempotent.
  await db.collection('keywords').createIndex(
    { org_id: 1, candidate_id: 1 },
    { unique: true, partialFilterExpression: { candidate_id: { $type: 'string' } } },
  );
  // Candidate-pool read: org/status filter + score/date ordering (#99).
  await db
    .collection('candidates')
    .createIndex({ org_id: 1, status: 1, opportunity_score: -1, created_at: 1 });
```

(keep every existing index line, including candidates' unique normalized index).

- [ ] **Step 2: migrations** (run before index creation on deploy) — extend `runMigrations()`:
  1. Backfill `normalized_keyword` on keywords missing it: cursor over `{ normalized_keyword: { $exists: false } }`, `updateOne` with `normalizeKeyword(doc.keyword)`.
  2. Resolve `(org_id, scheduled_date)` duplicates: aggregate `$group` by both, `count > 1`; keep the article-linked doc if any, else lowest `_id`; shift each extra to the next date (UTC +1 day, repeating while occupied) for that org.
  3. Resolve `(org_id, normalized_keyword)` duplicates: keep article-linked else lowest `_id`; delete unlinked extras; if two linked duplicates exist, throw with the offending ids (manual resolution — never delete a keyword whose article exists).
- [ ] **Step 3: Integration tests** — seed each anomaly, run `runMigrations()` + `ensureIndexes()`, assert invariants and idempotency (second run → zero changes); assert `ensureIndexes` converts a pre-existing non-unique date index.
- [ ] **Step 4:** `npm run test:integration` → PASS. Commit `"[backend] unique planner indexes + keyword migrations (#99)"`.

### Task B3: CandidateRepo methods

**Files:**
- Modify: `packages/shared/db/src/repositories/candidate.repo.ts`
- Test: `packages/shared/db/tests/candidate.repo.integration.test.ts`

**Interfaces:**
- Produces:
  - `findById(id: string): Promise<Candidate | null>`
  - `listByOrg(orgId, opts: { status?: CandidateStatus; limit?: number; offset?: number })` now returns `Promise<{ candidates: Candidate[]; total: number }>`, sorted `opportunity_score:-1, created_at:1, _id:1` (update existing callers/tests)
  - `claimForScheduling(candidateId): Promise<Candidate | null>` — `findOneAndUpdate({_id, status:'candidate'}, {$set:{status:'selected', updated_at:new Date()}}, {returnDocument:'after'})`
  - `releaseAfterUnschedule(candidateId): Promise<boolean>` — conditional `selected → candidate`

- [ ] TDD each method in the integration test file (claim succeeds once; second claim returns null; release restores; list pagination/total/ordering incl. null-score-last). Commit `"[backend] CandidateRepo: findById, paginated list, claim/release (#99)"`.

### Task B4: KeywordRepo methods

**Files:**
- Modify: `packages/shared/db/src/repositories/keyword.repo.ts`
- Test: `packages/shared/db/tests/keyword.repo.integration.test.ts`

**Interfaces:**
- Produces:
  - `findByOrgAndDate(orgId, date): Promise<Keyword | null>`
  - `findByCandidateId(orgId, candidateId): Promise<Keyword | null>`
  - `createFromCandidate(candidate: Candidate, scheduledDate: string): Promise<Keyword>` — copies `candidate_id, org_id, keyword, search_volume, difficulty, article_type, intent, opportunity_score, serp_competitors`; sets `status:'scheduled'`, `article_id:null`, `generation_status:'pending'`; throws if `search_volume`/`difficulty` null; duplicate-key errors propagate (service maps them)
  - `reschedulePending(keywordId, scheduledDate): Promise<Keyword | null>` — `findOneAndUpdate({_id, article_id:null, generation_status:'pending'}, {$set:{scheduled_date}}, {returnDocument:'after'})`
  - `deleteUnstarted(keywordId): Promise<Keyword | null>` — `findOneAndDelete({_id, article_id:null, generation_status:{$in:['pending','failed']}})`
  - `KeywordRepo.create` gains `candidate_id` pass-through automatically via schema default.

- [ ] TDD in integration tests, including: unique-index violation on `createFromCandidate` for occupied date raises `MongoServerError` with `keyPattern.scheduled_date`; reschedule refuses `generating`; delete refuses linked article. Commit `"[backend] KeywordRepo scheduling methods (#99)"`.

### Task B5: `scheduleCandidate` service

**Files:**
- Create: `packages/shared/db/src/services/schedule-candidate.ts`
- Modify: `packages/shared/db/src/index.ts` (export)
- Test: `packages/shared/db/tests/schedule-candidate.integration.test.ts`

**Interfaces:**
- Produces:

```ts
export type ScheduleConflict =
  | 'candidate_not_schedulable'
  | 'candidate_already_scheduled'
  | 'date_occupied'
  | 'keyword_already_scheduled';
export type ScheduleResult =
  | { ok: true; created: boolean; keyword: Keyword }
  | { ok: false; reason: ScheduleConflict };
export async function scheduleCandidate(
  candidate: Candidate,
  scheduledDate: string,
): Promise<ScheduleResult>;
```

- [ ] **Step 1: Failing integration tests** covering: happy path (keyword created, candidate `selected`, all fields copied); idempotent retry same candidate/date → `created:false`, no second keyword; same candidate different date → `candidate_already_scheduled`; occupied date → `date_occupied` **and the candidate is released back to `candidate`**; same normalized keyword via another candidate → `keyword_already_scheduled` + release; missing metrics / rejected status → `candidate_not_schedulable`; concurrency: `Promise.all` two different candidates same date → exactly one `ok:true created:true`; `Promise.all` same candidate two dates → exactly one success; partial-state reconciliation (candidate `selected`, no keyword → retry succeeds).
- [ ] **Step 2: Implement:**

```ts
import type { Candidate, Keyword } from '@shared/schemas';
import { MongoServerError } from 'mongodb';
import { CandidateRepo } from '../repositories/candidate.repo';
import { KeywordRepo } from '../repositories/keyword.repo';

/** Which unique index a duplicate-key error tripped. */
function dupKey(err: unknown): 'date' | 'keyword' | 'candidate' | null {
  if (!(err instanceof MongoServerError) || err.code !== 11000) return null;
  const kp = (err.keyPattern ?? {}) as Record<string, unknown>;
  if ('scheduled_date' in kp) return 'date';
  if ('normalized_keyword' in kp) return 'keyword';
  if ('candidate_id' in kp) return 'candidate';
  return null;
}

/**
 * Schedule a candidate onto the planner. No transactions (standalone Mongo):
 * conditional candidate claim + unique keyword indexes are the invariants, and
 * every failure path reconciles (release the claim / return the existing
 * keyword) so retries are idempotent. Shared by POST
 * /keywords/candidates/{id}/schedule and the strategy worker. See #99.
 */
export async function scheduleCandidate(
  candidate: Candidate,
  scheduledDate: string,
): Promise<ScheduleResult> {
  if (
    candidate.search_volume === null ||
    candidate.difficulty === null ||
    candidate.status === 'rejected'
  ) {
    return { ok: false, reason: 'candidate_not_schedulable' };
  }

  // Idempotency: an existing planner entry for this candidate wins.
  const existing = await KeywordRepo.findByCandidateId(candidate.org_id, candidate.id);
  if (existing) {
    return existing.scheduled_date === scheduledDate
      ? { ok: true, created: false, keyword: existing }
      : { ok: false, reason: 'candidate_already_scheduled' };
  }

  const claimed = await CandidateRepo.claimForScheduling(candidate.id);
  if (!claimed) {
    // Not claimable: either a concurrent/previous claim (reconcile) or rejected.
    const current = await CandidateRepo.findById(candidate.id);
    if (!current || current.status === 'rejected') {
      return { ok: false, reason: 'candidate_not_schedulable' };
    }
    const kw = await KeywordRepo.findByCandidateId(candidate.org_id, candidate.id);
    if (kw) {
      return kw.scheduled_date === scheduledDate
        ? { ok: true, created: false, keyword: kw }
        : { ok: false, reason: 'candidate_already_scheduled' };
    }
    // selected but keyword missing: a prior attempt died between claim and
    // insert — fall through and finish the job (unique indexes arbitrate races).
  }

  try {
    const keyword = await KeywordRepo.createFromCandidate(candidate, scheduledDate);
    return { ok: true, created: true, keyword };
  } catch (err) {
    const dup = dupKey(err);
    if (dup === 'candidate') {
      const kw = await KeywordRepo.findByCandidateId(candidate.org_id, candidate.id);
      if (kw && kw.scheduled_date === scheduledDate)
        return { ok: true, created: false, keyword: kw };
      return { ok: false, reason: 'candidate_already_scheduled' };
    }
    if (dup === 'date' || dup === 'keyword') {
      await CandidateRepo.releaseAfterUnschedule(candidate.id);
      return { ok: false, reason: dup === 'date' ? 'date_occupied' : 'keyword_already_scheduled' };
    }
    throw err;
  }
}
```

- [ ] **Step 3:** `npm run test:integration` → PASS. Commit `"[backend] scheduleCandidate service: claim + unique-index conflict mapping (#99)"`.

### Task B6: Organization capabilities

**Files:**
- Modify: `apps/api/src/schemas/core.ts`, `apps/api/src/routes/core.ts`
- Test: `apps/api/tests/core.test.ts`

- [ ] `Organization` schema gains:

```ts
    capabilities: z.object({
      keyword_research: z.boolean(),
      keyword_scheduling: z.boolean(),
    }),
```

- [ ] Route maps `capabilities: { keyword_research: isPaid(o), keyword_scheduling: isPaid(o) }` (import `isPaid` from `@shared/schemas`).
- [ ] Tests: paid org → both true; default/free org → both false.
- [ ] Commit `"[backend] expose keyword capabilities on GET /core/organizations (#99)"`.

### Task B7: Harden POST /keywords/research

**Files:**
- Modify: `apps/api/src/schemas/keywords.ts`, `apps/api/src/routes/keywords.ts`
- Test: `apps/api/tests/keywords.test.ts`, create `apps/api/tests/keywords.auth.test.ts`

- [ ] `ResearchBody.seed` → `z.string().trim().min(1).max(200)`; declare `400` (validation) and `401` responses on research **and** candidates routes (description-only is fine).
- [ ] Route: round metrics at the boundary — map seed + similar through

```ts
const toInt = (n: number | null) => (n === null ? null : Math.round(n));
const normMetric = (m: KeywordMetric) => ({
  ...m,
  search_volume: toInt(m.search_volume),
  difficulty: toInt(m.difficulty),
});
```

- [ ] Tests to add (existing mock pattern): whitespace-only seed → 400 before provider call; seed longer than 200 → 400; provider `DataForSeoError` → 502; similar bounded at 20 and excludes normalized seed (feed 25 ideas incl. the seed cased differently); float metrics come back rounded; `not_owner` → 403; **new file** without the auth mock: no `Authorization` header → 401 (set `process.env.JWT_SECRET` and hit `app.request('/research', {method:'POST',...})`).
- [ ] Route-level dedup tests for POST /candidates: duplicate keywords in one request → `addCandidates` receives both but response reflects skipped (assert against mock return), and repeated submission is idempotent at the service layer (already covered by integration tests — assert the route passes `org_id` + items through unchanged).
- [ ] Commit `"[backend] harden /keywords/research: trim/max seed, int metrics, 400/401 in OpenAPI (#99)"`.

### Task B8: GET /keywords/candidates

**Files:**
- Modify: `apps/api/src/schemas/keywords.ts`, `apps/api/src/routes/keywords.ts`
- Test: `apps/api/tests/keywords.test.ts`

**Interfaces:**
- Produces route `GET /candidates` with query schema:

```ts
export const CandidatesQuery = z
  .object({
    org_id: z.string(),
    status: z.enum(CANDIDATE_STATUSES).default('candidate'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .openapi('CandidatesQuery');

export const CandidateItem = z
  .object({
    id: z.string(),
    keyword: z.string(),
    search_volume: z.number().int().nullable(),
    difficulty: z.number().int().nullable(),
    cpc: z.number().nullable(),
    competition: z.number().nullable(),
    trend: z.number().nullable(),
    intent: z.enum(SEARCH_INTENTS).nullable(),
    article_type: z.enum(ARTICLE_TYPES).nullable(),
    relevance_score: z.number().nullable(),
    opportunity_score: z.number().nullable(),
    source: z.enum(CANDIDATE_SOURCES),
    status: z.enum(CANDIDATE_STATUSES),
    schedulable: z.boolean(),
    created_at: z.string(),
  })
  .openapi('CandidateItem');

export const CandidatesResponse = z
  .object({
    candidates: z.array(CandidateItem),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .openapi('CandidatesResponse');
```

- [ ] Handler: `authMiddleware` + `loadOwnedOrg` (404 `not_found`), **no paid gate**, `CandidateRepo.listByOrg(org_id, { status, limit, offset })`, map `schedulable: c.search_volume !== null && c.difficulty !== null`, `created_at: c.created_at.toISOString()`. Declared responses: 200, 400, 401, 404.
- [ ] Tests: 404 unowned; empty pool → `{candidates: [], total: 0}`; status filter passed to repo; pagination echoes limit/offset; `schedulable` false when metrics null; free org can read (no 402).
- [ ] Commit `"[backend] GET /keywords/candidates: paginated candidate pool (#99)"`.

### Task B9: POST /keywords/candidates/{candidate_id}/schedule

**Files:**
- Modify: `apps/api/src/schemas/keywords.ts`, `apps/api/src/routes/keywords.ts`
- Test: `apps/api/tests/keywords.test.ts`

**Interfaces:**

```ts
export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDateOnly(s: string): boolean {
  if (!DATE_ONLY.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export const ScheduleParams = z.object({ candidate_id: z.string() });
export const ScheduleBody = z
  .object({ scheduled_date: z.string().regex(DATE_ONLY) })
  .openapi('ScheduleBody');
export const ScheduledKeyword = z
  .object({
    id: z.string(),
    candidate_id: z.string().nullable(),
    keyword: z.string(),
    status: z.enum(['scheduled']),
    scheduled_date: z.string(),
    search_volume: z.number().int(),
    difficulty: z.number().int(),
    article_type: z.enum(ARTICLE_TYPES).nullable(),
    intent: z.enum(SEARCH_INTENTS).nullable(),
    opportunity_score: z.number().nullable(),
    generation_status: z.enum(GENERATION_STATUSES),
    generation_error: z.string().nullable(),
    article_id: z.string().nullable(),
  })
  .openapi('ScheduledKeyword');
export const ScheduledKeywordResponse = z
  .object({ keyword: ScheduledKeyword })
  .openapi('ScheduledKeywordResponse');
```

plus a `toScheduledKeyword(k: Keyword)` mapper in the route file.

- [ ] Handler flow: validate `isValidDateOnly` (else 400 `{error:'invalid_date'}`); `CandidateRepo.findById` → 404 `not_found` if missing; `loadOwnedOrg(candidate.org_id, userId)` → 404; `isPaid(org)` → 402 `not_paid`; require `candidate.status !== 'selected' || <handled by service>` — just call `scheduleCandidate(candidate, scheduled_date)`; map result: `created:true` → 201, `created:false` → 200, conflicts → 409 with reason string. Declared responses: 200, 201, 400, 401, 402, 404, 409.
- [ ] Tests (mock `@shared/db` exports `scheduleCandidate`, `CandidateRepo`; mock `loadOwnedOrg`): 201 first time with copied fields; 200 idempotent retry; each 409 reason; 402 free org (service untouched); 404 unknown candidate/unowned org; 400 bad date (`2026-02-30`, `20260720`); asserts no DataForSEO/LLM client import is touched.
- [ ] Commit `"[backend] POST /keywords/candidates/{id}/schedule (#99)"`.

### Task B10: PATCH + DELETE /keywords/scheduled/{keyword_id}

**Files:**
- Modify: `apps/api/src/schemas/keywords.ts` (`RescheduleBody` = same shape as `ScheduleBody`), `apps/api/src/routes/keywords.ts`
- Test: `apps/api/tests/keywords.test.ts`

- [ ] **PATCH flow:** load `KeywordRepo.findById` → 404; `loadOwnedOrg` → 404; paid → 402; `isValidDateOnly` → 400; same date + still pending/unlinked → 200 unchanged; `article_id !== null || generation_status !== 'pending'` → 409 `generation_started`; `KeywordRepo.reschedulePending` inside try/catch — duplicate-key (`scheduled_date`) → 409 `date_occupied`; `null` result → re-check and 409 `generation_started`. Candidate status untouched. 200 with `ScheduledKeywordResponse`.
- [ ] **DELETE flow:** load + own + paid as above; `KeywordRepo.deleteUnstarted` → `null` → 409 `generation_started` (when keyword exists but is linked/generating/generated); on success, if `deleted.candidate_id` → `CandidateRepo.releaseAfterUnschedule(candidate_id)`; return 204 (`c.body(null, 204)`).
- [ ] Tests: reschedule success/idempotent-same-date/occupied/generation-started; delete 204 + release called; delete refused after generation start; both 404 unowned, 402 free.
- [ ] Commit `"[backend] reschedule + remove scheduled keywords (#99)"`.

### Task B11: Extend planner response

**Files:**
- Modify: `apps/api/src/schemas/dashboard.ts` (`PlannerKeyword`), `apps/api/src/routes/dashboard.ts` (mapper)
- Test: `apps/api/tests/dashboard.test.ts`

- [ ] `PlannerKeyword` gains `candidate_id: z.string().nullable()`, `article_type: z.enum(ARTICLE_TYPES).nullable()`, `intent: z.enum(SEARCH_INTENTS).nullable()`, `opportunity_score: z.number().nullable()`, `generation_status: z.enum(GENERATION_STATUSES)`, `generation_error: z.string().nullable()`; route mapper passes them through.
- [ ] Test: planner row exposes the new fields; legacy keyword (schema defaults) yields `candidate_id: null`.
- [ ] Commit `"[backend] planner response: candidate linkage + classification + generation state (#99)"`.

### Task B12: Strategy worker uses the shared invariants

**Files:**
- Modify: `apps/worker/src/strategy.ts`
- Test: `apps/worker/tests/strategy.test.ts`

- [ ] Replace the `KeywordRepo.create` + `setStatus` loop with:

```ts
      const occupied = new Set(scheduled.map((k) => k.scheduled_date));
      const nextFree = (from: string): string => {
        const d = new Date(`${from}T00:00:00.000Z`);
        let iso = from;
        while (occupied.has(iso)) {
          d.setUTCDate(d.getUTCDate() + 1);
          iso = d.toISOString().slice(0, 10);
        }
        return iso;
      };
      for (const c of plan) {
        const stored = await CandidateRepo.findByNormalized(orgId, normalizeKeyword(c.keyword));
        if (!stored) continue;
        const date = nextFree(c.scheduled_date);
        const res = await scheduleCandidate(stored, date);
        if (res.ok) {
          occupied.add(res.keyword.scheduled_date);
        } else if (res.reason === 'date_occupied') {
          // Concurrent write claimed the date; take the next free one.
          occupied.add(date);
          const retry = await scheduleCandidate(stored, nextFree(date));
          if (retry.ok) occupied.add(retry.keyword.scheduled_date);
          else logger.warn('strategy schedule skipped', { keyword: c.keyword, reason: retry.reason });
        } else {
          logger.info('strategy schedule skipped', { keyword: c.keyword, reason: res.reason });
        }
      }
```

  (`scheduleCandidate` stores `candidate_id`, flips the candidate to `selected` only around successful creation, and per-entry conflicts no longer throw the whole job.)
- [ ] Update `strategy.test.ts` mocks (`scheduleCandidate` instead of `KeywordRepo.create`/`setStatus`); add: occupied date is skipped to next free; a `keyword_already_scheduled` conflict doesn't fail the job; plan size respected.
- [ ] Commit `"[backend] strategy worker schedules via shared service, skips occupied dates (#99)"`.

### Task B13: Verify, docs, PR

- [ ] `npm run lint` / `npm run check:all` / `npm test` / `npm run test:integration` all green.
- [ ] `PROGRESS.md`: mark manual planner scheduling as built, one line + `[#99]`.
- [ ] Push, open stacked PR into `dev` (base: Part A branch until it merges): title `[backend] candidate-pool reads + manual planner scheduling APIs`, body: endpoints, error contract, index/migration ordering (`db migrate` **before** `db init`), concurrency model, `Closes #99`.

## Self-review notes

- Spec coverage: research hardening (B7), pool read (B8), schedule (B9), reschedule/remove (B10), planner fields (B11), capabilities (B6), candidate_id + indexes + repo methods (B1–B4), shared service + concurrency (B5), strategy worker (B12), generation pipeline needs no change (deleted keywords already fail `claimGeneration` → worker skips). Optional `added_candidates` response extension: **skipped** (spec marks it not required; frontend refetches the pool).
- 403 vs 404: existing research/candidates keep 403 `not_owner`; new endpoints follow their explicit 404 spec. Called out in PR body.
- Types: `ScheduleResult`/`ScheduleConflict` names used consistently in B5/B9/B12; `listByOrg` return shape change updates its integration-test caller (B3) and has no other production callers (verified via grep — only strategy uses `findByNormalized`).
