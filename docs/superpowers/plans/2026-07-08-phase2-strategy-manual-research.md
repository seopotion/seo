# Phase 2 — Entitlement, Manual Research (#50), Auto Strategy (#47) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `runKeywordPipeline` into two paid-gated consumers — a manual keyword-research API (#50) and an automatic 30-day content-strategy job (#47) — behind a thin entitlement seam.

**Architecture:** Add a `plan` field + `isPaid` gate to `Org` (the seam #13 later backs with Stripe). A shared `addCandidates` service persists pipeline output into the candidate pool, deduping against scheduled planner keywords. #50 is two API endpoints on a new `/keywords` router. #47 triggers on `/setup/finalize` for paid orgs, enqueues to a **new SQS strategy queue**, and a **second worker Lambda** runs the pipeline, selects the top 30, cluster-spreads them across 30 days, and writes planner entries.

**Tech Stack:** TypeScript, `@hono/zod-openapi`, Zod 4, mongodb driver, AWS SQS + Lambda, CDK, Vitest 4.

## Global Constraints

- `OpenAPIHono` everywhere (never plain `Hono`); every route uses `createRoute(...).openapi(...)` and is mounted so it feeds `AppType`.
- Zod API schemas call `.openapi('Name')`; export both the schema and its `z.infer` type.
- `import type` / `export type` for type-only imports (`verbatimModuleSyntax`).
- Shared packages export TS source; internal deps use `"*"`.
- Repositories own `_id` ↔ string `id` mapping and `parse` through Zod at the boundary; app code never touches the driver directly.
- Tests: mock external clients / `@shared/db` with `vi.mock` (auto-hoisted); `vi.hoisted` for asserted spies; drive HTTP via `testClient<AppType>(app)` / `app.request()`.
- Provider secrets are read from `process.env` (`DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `OPENROUTER_API_KEY`); deployed-env secret provisioning is deferred (manual, tracked alongside #9/#43) and out of scope here.
- Gates before "done": `npm run lint`, `npm run check:all`, `npm test`.
- Branch: `faruk/phase2-content-strategy` (already created off `dev`). PRs target `dev`.

---

## File Structure

**Phase A — substrate**
- Modify `packages/shared/types/src/index.ts` — add `ENTITLEMENT_PLANS`, `STRATEGY_STATUSES`.
- Modify `packages/shared/schemas/src/org.ts` — add `plan`, `strategy_status`; export `isPaid`.
- Modify `packages/shared/schemas/src/candidate.ts` — add `serp_competitors`.
- Modify `packages/shared/schemas/src/keyword.ts` — add planner brief fields.
- Modify `packages/shared/db/src/repositories/org.repo.ts` — `claimStrategy`, `setStrategyStatus`.
- Modify `packages/shared/db/src/repositories/candidate.repo.ts` — `excludeNormalized` option.
- Modify `packages/shared/db/src/repositories/keyword.repo.ts` — `scheduledNormalizedSet`, richer `create`.
- Create `packages/shared/db/src/services/add-candidates.ts` — `addCandidates`.
- Modify `packages/shared/db/src/index.ts` — export the service.
- Create `apps/api/src/lib/load-owned-paid-org.ts` — `loadOwnedPaidOrg`.

**Phase B — #50**
- Create `apps/api/src/schemas/keywords.ts` — request/response schemas.
- Create `apps/api/src/routes/keywords.ts` — `/research`, `/candidates`.
- Modify `apps/api/src/routes/index.ts` — mount `/keywords`.
- Create `apps/api/src/clients/providers.ts` — env-backed `getDataForSeoClient`.

**Phase C — #47**
- Modify `packages/shared/keywords/src/types.ts` — `serp_competitors` on working/enriched.
- Modify `packages/shared/keywords/src/serp.ts` — capture top-K domains.
- Modify `packages/shared/keywords/src/pipeline.ts` — thread `serp_competitors`.
- Modify `packages/shared/schemas/src/scan.ts` — add `StrategyTask`.
- Modify `apps/api/src/clients/sqs.ts` — `enqueueStrategyTask`.
- Modify `apps/api/src/routes/setup.ts` — finalize trigger.
- Create `packages/shared/keywords/src/schedule.ts` — `clusterSpreadSchedule` (pure).
- Modify `packages/shared/keywords/src/index.ts` — export scheduler.
- Create `apps/worker/src/providers.ts` — env-backed client factories.
- Create `apps/worker/src/strategy.ts` — `strategyHandler`.
- Modify `apps/worker/src/dev.ts` — run strategy poller locally.
- Modify `apps/worker/package.json` — add `@shared/keywords`, `@shared/providers`.
- Modify `infra/lib/api-stack.ts` — strategy queue, DLQ, worker Lambda, env.

---

## PHASE A — Substrate

### Task A1: Entitlement + strategy-status enums and Org schema

**Files:**
- Modify: `packages/shared/types/src/index.ts`
- Modify: `packages/shared/schemas/src/org.ts`
- Test: `packages/shared/schemas/tests/org.test.ts` (create)

**Interfaces:**
- Produces: `ENTITLEMENT_PLANS`, `EntitlementPlan`, `STRATEGY_STATUSES`, `StrategyStatus` (from `@shared/types`); `Org.plan: 'free'|'trial'|'paid'`, `Org.strategy_status: 'none'|'pending'|'completed'|'failed'`; `isPaid(org: Org): boolean` (from `@shared/schemas`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/schemas/tests/org.test.ts
import { describe, expect, test } from 'vitest';
import { isPaid, OrgSchema } from '../src/org';

const base = {
  id: '1',
  user_id: 'u1',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  created_at: new Date(),
};

describe('OrgSchema entitlement', () => {
  test('plan and strategy_status default when absent (back-compat)', () => {
    const org = OrgSchema.parse(base);
    expect(org.plan).toBe('free');
    expect(org.strategy_status).toBe('none');
  });

  test('isPaid is true only for the paid plan', () => {
    expect(isPaid(OrgSchema.parse({ ...base, plan: 'paid' }))).toBe(true);
    expect(isPaid(OrgSchema.parse({ ...base, plan: 'trial' }))).toBe(false);
    expect(isPaid(OrgSchema.parse(base))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- org`
Expected: FAIL — `isPaid` is not exported / `plan` is undefined.

- [ ] **Step 3: Add the enums to `@shared/types`**

Append to `packages/shared/types/src/index.ts`:

```ts
/** Billing entitlement plans. `paid` unlocks the automated pipeline (#56). */
export const ENTITLEMENT_PLANS = ['free', 'trial', 'paid'] as const;
export type EntitlementPlan = (typeof ENTITLEMENT_PLANS)[number];

/** Lifecycle of an org's automatic 30-day strategy job (#47). */
export const STRATEGY_STATUSES = ['none', 'pending', 'completed', 'failed'] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];
```

- [ ] **Step 4: Extend `OrgSchema` and add `isPaid`**

In `packages/shared/schemas/src/org.ts`, update imports and schema:

```ts
import { ENTITLEMENT_PLANS, SETUP_STATUSES, STRATEGY_STATUSES } from '@shared/types';
import { z } from 'zod';
import { SetupPresetsSchema } from './presets';

export const OrgSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  website_url: z.string().url(),
  setup_status: z.enum(SETUP_STATUSES),
  // Billing entitlement. Defaults keep orgs stored before #56 backward-compatible.
  plan: z.enum(ENTITLEMENT_PLANS).default('free'),
  // Automatic-strategy job lifecycle (#47).
  strategy_status: z.enum(STRATEGY_STATUSES).default('none'),
  name: z.string().optional(),
  presets: SetupPresetsSchema.optional(),
  created_at: z.date(),
});
export type Org = z.infer<typeof OrgSchema>;

/** True when the org has an active paid entitlement. #13 later backs this with Stripe. */
export function isPaid(org: Org): boolean {
  return org.plan === 'paid';
}
```

Keep the existing `CreateOrgInput` block as-is (it already omits `id`/`created_at`/`presets`; `plan`/`strategy_status` fall back to their defaults on create).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- org`
Expected: PASS (both tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/types/src/index.ts packages/shared/schemas/src/org.ts packages/shared/schemas/tests/org.test.ts
git commit -m "[shared] Add entitlement plan + strategy_status to Org, isPaid helper

Part of #56 (#47/#50 entitlement seam)."
```

---

### Task A2: OrgRepo strategy claim + status writers

**Files:**
- Modify: `packages/shared/db/src/repositories/org.repo.ts`
- Test: `packages/shared/db/tests/org.repo.strategy.test.ts` (create; integration — real Mongo)

**Interfaces:**
- Consumes: `Org.strategy_status`, `StrategyStatus`.
- Produces: `OrgRepo.claimStrategy(id: string): Promise<boolean>` (true iff this call transitioned `strategy_status` from `none`/`failed` → `pending`); `OrgRepo.setStrategyStatus(id: string, status: StrategyStatus): Promise<void>`.

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/shared/db/tests/org.repo.strategy.test.ts
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { getDb } from '../src/client';
import { OrgRepo } from '../src/repositories/org.repo';

async function seedOrg(strategy_status: string): Promise<string> {
  const res = await (await getDb()).collection('orgs').insertOne({
    user_id: 'u1',
    website_url: 'https://example.com',
    setup_status: 'setup_complete',
    plan: 'paid',
    strategy_status,
    created_at: new Date(),
  });
  return res.insertedId.toString();
}

describe('OrgRepo strategy claim', () => {
  beforeEach(async () => {
    await (await getDb()).collection('orgs').deleteMany({});
  });
  afterAll(async () => {
    await (await getDb()).collection('orgs').deleteMany({});
  });

  test('claimStrategy wins once from none, then loses', async () => {
    const id = await seedOrg('none');
    expect(await OrgRepo.claimStrategy(id)).toBe(true);
    expect(await OrgRepo.claimStrategy(id)).toBe(false);
    expect((await OrgRepo.findById(id))?.strategy_status).toBe('pending');
  });

  test('claimStrategy re-claims after failure', async () => {
    const id = await seedOrg('failed');
    expect(await OrgRepo.claimStrategy(id)).toBe(true);
  });

  test('setStrategyStatus updates the field', async () => {
    const id = await seedOrg('pending');
    await OrgRepo.setStrategyStatus(id, 'completed');
    expect((await OrgRepo.findById(id))?.strategy_status).toBe('completed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose up -d mongo && npm run test:integration -- org.repo.strategy`
Expected: FAIL — `claimStrategy` is not a function.

- [ ] **Step 3: Implement the repo methods**

Append inside the `OrgRepo` object in `packages/shared/db/src/repositories/org.repo.ts` (after `finalize`):

```ts
  /**
   * Atomically claim the automatic-strategy job for this org. Flips
   * `strategy_status` none|failed -> pending and returns true only for the call
   * that won the transition, so `/setup/finalize` enqueues exactly one job even
   * under retries/re-finalize.
   */
  async claimStrategy(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), strategy_status: { $in: ['none', 'failed'] } },
      { $set: { strategy_status: 'pending' } },
    );
    return res.modifiedCount === 1;
  },

  async setStrategyStatus(id: string, status: StrategyStatus): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { strategy_status: status } },
    );
  },
```

Add `StrategyStatus` to the type import from `@shared/types`:

```ts
import type { SetupStatus, StrategyStatus } from '@shared/types';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:integration -- org.repo.strategy`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/db/src/repositories/org.repo.ts packages/shared/db/tests/org.repo.strategy.test.ts
git commit -m "[shared] OrgRepo.claimStrategy + setStrategyStatus (#47 idempotency)"
```

---

### Task A3: Candidate/keyword dedup plumbing + `addCandidates`

**Files:**
- Modify: `packages/shared/db/src/repositories/candidate.repo.ts`
- Modify: `packages/shared/db/src/repositories/keyword.repo.ts`
- Create: `packages/shared/db/src/services/add-candidates.ts`
- Modify: `packages/shared/db/src/index.ts`
- Test: `packages/shared/db/tests/add-candidates.test.ts` (create; integration)

**Interfaces:**
- Consumes: `CandidateRepo.insertMany`, `normalizeKeyword`.
- Produces:
  - `CandidateRepo.insertMany(orgId, items, opts?: { excludeNormalized?: Set<string> })`
  - `KeywordRepo.scheduledNormalizedSet(orgId: string): Promise<Set<string>>`
  - `addCandidates(orgId: string, items: CreateCandidateInput[]): Promise<Candidate[]>` (exported from `@shared/db`).

- [ ] **Step 1: Write the failing integration test**

```ts
// packages/shared/db/tests/add-candidates.test.ts
import { normalizeKeyword } from '@shared/schemas';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { getDb } from '../src/client';
import { addCandidates } from '../src/services/add-candidates';

describe('addCandidates', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.collection('candidates').deleteMany({});
    await db.collection('keywords').deleteMany({});
  });
  afterAll(async () => {
    const db = await getDb();
    await db.collection('candidates').deleteMany({});
    await db.collection('keywords').deleteMany({});
  });

  test('skips keywords already scheduled in the planner', async () => {
    await (await getDb()).collection('keywords').insertOne({
      org_id: 'o1',
      keyword: 'Best CRM',
      normalized_keyword: normalizeKeyword('Best CRM'),
      status: 'scheduled',
      scheduled_date: '2026-07-08',
      search_volume: 100,
      difficulty: 10,
      article_id: null,
      created_at: new Date(),
    });

    const added = await addCandidates('o1', [
      { org_id: 'o1', keyword: 'best crm', source: 'manual' },
      { org_id: 'o1', keyword: 'crm pricing', source: 'manual' },
    ]);

    expect(added.map((c) => c.keyword)).toEqual(['crm pricing']);
  });
});
```

Note: `keywords` currently stores no `normalized_keyword`; Task A4 adds it on write. Seed it directly here.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- add-candidates`
Expected: FAIL — cannot import `../src/services/add-candidates`.

- [ ] **Step 3: Add `excludeNormalized` to `insertMany`**

In `packages/shared/db/src/repositories/candidate.repo.ts`, change the signature and add the filter right after the within-batch dedupe (`const batch = ...`):

```ts
  async insertMany(
    orgId: string,
    items: CreateCandidateInput[],
    opts: { excludeNormalized?: Set<string> } = {},
  ): Promise<Candidate[]> {
    if (items.length === 0) return [];

    const prepared = items.map((item) => {
      const data = CreateCandidateInputSchema.parse({ ...item, org_id: orgId });
      return { ...data, normalized_keyword: normalizeKeyword(data.keyword) };
    });

    const seen = new Set<string>();
    const exclude = opts.excludeNormalized ?? new Set<string>();
    const batch = prepared.filter(
      (p) =>
        !exclude.has(p.normalized_keyword) &&
        !seen.has(p.normalized_keyword) &&
        seen.add(p.normalized_keyword),
    );
    // ...unchanged from here (existing-candidate dedupe + insert)...
```

- [ ] **Step 4: Add `scheduledNormalizedSet` to `KeywordRepo`**

In `packages/shared/db/src/repositories/keyword.repo.ts`, import `normalizeKeyword` and add:

```ts
  /** Normalized set of every keyword already on this org's planner. */
  async scheduledNormalizedSet(orgId: string): Promise<Set<string>> {
    const docs = await (await collection())
      .find({ org_id: orgId }, { projection: { keyword: 1 } })
      .toArray();
    return new Set(docs.map((d) => normalizeKeyword(d.keyword as string)));
  },
```

Import line: `import { ..., normalizeKeyword } from '@shared/schemas';` (merge with the existing schema import).

- [ ] **Step 5: Create the `addCandidates` service**

```ts
// packages/shared/db/src/services/add-candidates.ts
import type { Candidate, CreateCandidateInput } from '@shared/schemas';
import { CandidateRepo } from '../repositories/candidate.repo';
import { KeywordRepo } from '../repositories/keyword.repo';

/**
 * Persist candidates into the pool, deduping against both existing candidates
 * (handled by CandidateRepo) and keywords already scheduled on the planner.
 * Shared by the #50 manual-selection handler and the #47 strategy worker.
 */
export async function addCandidates(
  orgId: string,
  items: CreateCandidateInput[],
): Promise<Candidate[]> {
  const excludeNormalized = await KeywordRepo.scheduledNormalizedSet(orgId);
  return CandidateRepo.insertMany(orgId, items, { excludeNormalized });
}
```

Add to `packages/shared/db/src/index.ts`:

```ts
export { addCandidates } from './services/add-candidates';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:integration -- add-candidates`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/db/src/repositories/candidate.repo.ts packages/shared/db/src/repositories/keyword.repo.ts packages/shared/db/src/services/add-candidates.ts packages/shared/db/src/index.ts packages/shared/db/tests/add-candidates.test.ts
git commit -m "[shared] addCandidates service: dedup pool inserts vs scheduled keywords"
```

---

### Task A4: Schema fields — candidate SERP competitors + planner brief

**Files:**
- Modify: `packages/shared/schemas/src/candidate.ts`
- Modify: `packages/shared/schemas/src/keyword.ts`
- Modify: `packages/shared/db/src/repositories/keyword.repo.ts`
- Test: `packages/shared/schemas/tests/keyword.test.ts` (create)

**Interfaces:**
- Produces: `Candidate.serp_competitors: string[] | null`; `Keyword.article_type/intent/opportunity_score/serp_competitors` (all nullable, default null); `KeywordRepo.create` persists `normalized_keyword`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/schemas/tests/keyword.test.ts
import { describe, expect, test } from 'vitest';
import { KeywordSchema } from '../src/keyword';

const base = {
  id: '1',
  org_id: 'o1',
  keyword: 'best crm',
  status: 'scheduled',
  scheduled_date: '2026-07-08',
  search_volume: 100,
  difficulty: 10,
  article_id: null,
  created_at: new Date(),
};

describe('KeywordSchema brief fields', () => {
  test('brief fields default to null (back-compat)', () => {
    const k = KeywordSchema.parse(base);
    expect(k.article_type).toBeNull();
    expect(k.intent).toBeNull();
    expect(k.opportunity_score).toBeNull();
    expect(k.serp_competitors).toBeNull();
  });

  test('brief fields round-trip when present', () => {
    const k = KeywordSchema.parse({
      ...base,
      article_type: 'how_to_guide',
      intent: 'informational',
      opportunity_score: 0.8,
      serp_competitors: ['a.com', 'b.com'],
    });
    expect(k.article_type).toBe('how_to_guide');
    expect(k.serp_competitors).toEqual(['a.com', 'b.com']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- keyword`
Expected: FAIL — extra keys stripped / fields undefined.

- [ ] **Step 3: Add `serp_competitors` to `CandidateSchema`**

In `packages/shared/schemas/src/candidate.ts`, add to `CandidateSchema` (after `intent`):

```ts
  // Top-K organic domains captured during SERP validation (#47); null otherwise.
  serp_competitors: z.array(z.string()).nullable().default(null),
```

- [ ] **Step 4: Extend `KeywordSchema`**

In `packages/shared/schemas/src/keyword.ts`, import the shared enums and add the fields:

```ts
import { ARTICLE_TYPES, SEARCH_INTENTS } from './candidate';
import { z } from 'zod';
```

Add inside `KeywordSchema` (after `article_id`):

```ts
  // Planner brief (populated by the #47 strategy job; null for older/manual entries).
  article_type: z.enum(ARTICLE_TYPES).nullable().default(null),
  intent: z.enum(SEARCH_INTENTS).nullable().default(null),
  opportunity_score: z.number().nullable().default(null),
  serp_competitors: z.array(z.string()).nullable().default(null),
```

Also add `normalized_keyword: z.string()` to `KeywordSchema` (after `keyword`) so planner dedup can key on it, and omit it from `CreateKeywordInput` (the repo derives it):

```ts
export const CreateKeywordInput = KeywordSchema.omit({
  id: true,
  normalized_keyword: true,
  created_at: true,
});
```

- [ ] **Step 5: Persist `normalized_keyword` in `KeywordRepo.create`**

In `packages/shared/db/src/repositories/keyword.repo.ts`, update `create` to derive the key:

```ts
  async create(input: CreateKeywordInput): Promise<Keyword> {
    const data = CreateKeywordInputSchema.parse(input);
    const created_at = new Date();
    const normalized_keyword = normalizeKeyword(data.keyword);
    const res = await (await collection()).insertOne({ ...data, normalized_keyword, created_at });
    return toEntity({ _id: res.insertedId, ...data, normalized_keyword, created_at });
  },
```

Ensure imports include `CreateKeywordInput as CreateKeywordInputSchema` and `normalizeKeyword` from `@shared/schemas`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- keyword && npm run check:all`
Expected: PASS; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/schemas/src/candidate.ts packages/shared/schemas/src/keyword.ts packages/shared/db/src/repositories/keyword.repo.ts packages/shared/schemas/tests/keyword.test.ts
git commit -m "[shared] Add SERP competitors to candidate + brief fields to planner keyword"
```

---

### Task A5: `loadOwnedPaidOrg` API helper

**Files:**
- Create: `apps/api/src/lib/load-owned-paid-org.ts`
- Test: `apps/api/tests/load-owned-paid-org.test.ts` (create)

**Interfaces:**
- Consumes: `OrgRepo.findById`, `isPaid`.
- Produces: `loadOwnedPaidOrg(orgId: string, userId: string): Promise<{ ok: true; org: Org } | { ok: false; reason: 'not_found' | 'not_owner' | 'not_paid' }>`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/load-owned-paid-org.test.ts
import { describe, expect, test, vi } from 'vitest';

const { findById } = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('@shared/db', () => ({ OrgRepo: { findById } }));

import { loadOwnedPaidOrg } from '../src/lib/load-owned-paid-org';

const org = (over: Record<string, unknown>) => ({
  id: 'o1',
  user_id: 'u1',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  plan: 'paid',
  strategy_status: 'none',
  created_at: new Date(),
  ...over,
});

describe('loadOwnedPaidOrg', () => {
  test('not_found when missing', async () => {
    findById.mockResolvedValueOnce(null);
    expect(await loadOwnedPaidOrg('o1', 'u1')).toEqual({ ok: false, reason: 'not_found' });
  });
  test('not_owner for a different user', async () => {
    findById.mockResolvedValueOnce(org({ user_id: 'someone_else' }));
    expect(await loadOwnedPaidOrg('o1', 'u1')).toEqual({ ok: false, reason: 'not_owner' });
  });
  test('not_paid for free plan', async () => {
    findById.mockResolvedValueOnce(org({ plan: 'free' }));
    expect(await loadOwnedPaidOrg('o1', 'u1')).toEqual({ ok: false, reason: 'not_paid' });
  });
  test('ok for owned paid org', async () => {
    const paid = org({});
    findById.mockResolvedValueOnce(paid);
    expect(await loadOwnedPaidOrg('o1', 'u1')).toEqual({ ok: true, org: paid });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- load-owned-paid-org`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```ts
// apps/api/src/lib/load-owned-paid-org.ts
import { OrgRepo } from '@shared/db';
import { isPaid, type Org } from '@shared/schemas';

export type OwnedPaidResult =
  | { ok: true; org: Org }
  | { ok: false; reason: 'not_found' | 'not_owner' | 'not_paid' };

/**
 * Load an org that the caller owns AND that has an active paid entitlement.
 * `not_found` and `not_owner` are distinct so handlers can 404 vs 403; `not_paid`
 * maps to 402 so the client can route to billing. #13 later backs `isPaid`.
 */
export async function loadOwnedPaidOrg(orgId: string, userId: string): Promise<OwnedPaidResult> {
  const org = await OrgRepo.findById(orgId);
  if (!org) return { ok: false, reason: 'not_found' };
  if (org.user_id !== userId) return { ok: false, reason: 'not_owner' };
  if (!isPaid(org)) return { ok: false, reason: 'not_paid' };
  return { ok: true, org };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- load-owned-paid-org`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/load-owned-paid-org.ts apps/api/tests/load-owned-paid-org.test.ts
git commit -m "[api] loadOwnedPaidOrg helper (ownership + paid entitlement)"
```

---

## PHASE B — #50 Manual keyword research API

### Task B1: Provider client factory (API)

**Files:**
- Create: `apps/api/src/clients/providers.ts`
- Modify: `apps/api/package.json` (add `@shared/providers` if absent)
- Test: none (thin env wiring; exercised via B2/B3 with a mocked module).

**Interfaces:**
- Produces: `getDataForSeoClient(): DataForSeoClient` — built once from `process.env.DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD`.

- [ ] **Step 1: Confirm the dep**

Run: `grep '@shared/providers' apps/api/package.json || echo MISSING`
If `MISSING`, add `"@shared/providers": "*"` to `apps/api/package.json` dependencies and run `npm install`.

- [ ] **Step 2: Implement the factory**

```ts
// apps/api/src/clients/providers.ts
import { createDataForSeoClient, type DataForSeoClient } from '@shared/providers';

let client: DataForSeoClient | undefined;

/** Module-scoped DataForSEO client (warm-reuse across Lambda invocations). */
export function getDataForSeoClient(): DataForSeoClient {
  if (!client) {
    client = createDataForSeoClient({
      login: process.env.DATAFORSEO_LOGIN ?? '',
      password: process.env.DATAFORSEO_PASSWORD ?? '',
    });
  }
  return client;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/clients/providers.ts apps/api/package.json package-lock.json
git commit -m "[api] Env-backed DataForSEO client factory"
```

---

### Task B2: `/keywords` schemas + `POST /keywords/research`

**Files:**
- Create: `apps/api/src/schemas/keywords.ts`
- Create: `apps/api/src/routes/keywords.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/tests/keywords.test.ts` (create)

**Interfaces:**
- Consumes: `loadOwnedPaidOrg`, `getDataForSeoClient`, `authMiddleware`, `AuthEnv`.
- Produces: `KeywordMetric` schema; `ResearchBody` `{ org_id, seed }`; `ResearchResponse` `{ seed, similar }`; router default export mounted at `/keywords`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/tests/keywords.test.ts
import { testClient } from 'hono/testing';
import { describe, expect, test, vi } from 'vitest';

const { loadOwnedPaidOrg } = vi.hoisted(() => ({ loadOwnedPaidOrg: vi.fn() }));
vi.mock('../src/lib/load-owned-paid-org', () => ({ loadOwnedPaidOrg }));

const { keywordIdeas, bulkKeywordDifficulty } = vi.hoisted(() => ({
  keywordIdeas: vi.fn(),
  bulkKeywordDifficulty: vi.fn(),
}));
vi.mock('../src/clients/providers', () => ({
  getDataForSeoClient: () => ({ keywordIdeas, bulkKeywordDifficulty }),
}));

// authMiddleware sets c.var.auth from the JWT; stub it to a fixed user.
vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: any, next: any) => {
      c.set('auth', { userId: 'u1', email: 'u1@example.com' });
      await next();
    },
  };
});

import app from '../src/routes/keywords';

const paidOrg = {
  ok: true,
  org: { id: 'o1', user_id: 'u1', plan: 'paid', presets: { business: { language: 'English', country: 'Global (English)' } } },
};

describe('POST /research', () => {
  test('returns seed metrics + bounded similar', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce(paidOrg);
    bulkKeywordDifficulty.mockResolvedValueOnce([
      { keyword: 'crm', search_volume: 500, difficulty: 40, cpc: 2, competition: 0.5, trend: 0, intent: 'commercial' },
    ]);
    keywordIdeas.mockResolvedValueOnce([
      { keyword: 'best crm', search_volume: 300, difficulty: 30, cpc: 1, competition: 0.3, trend: 0, intent: 'commercial' },
    ]);

    const client = testClient(app);
    const res = await client.research.$post({ json: { org_id: 'o1', seed: 'crm' } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seed.keyword).toBe('crm');
    expect(body.similar).toHaveLength(1);
  });

  test('402 for a free org', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce({ ok: false, reason: 'not_paid' });
    const res = await testClient(app).research.$post({ json: { org_id: 'o1', seed: 'crm' } });
    expect(res.status).toBe(402);
    expect(keywordIdeas).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- keywords`
Expected: FAIL — `../src/routes/keywords` not found.

- [ ] **Step 3: Write the schemas**

```ts
// apps/api/src/schemas/keywords.ts
import { SEARCH_INTENTS } from '@shared/schemas';
import { z } from '@hono/zod-openapi';

export const KeywordMetric = z
  .object({
    keyword: z.string(),
    search_volume: z.number().int().nullable(),
    difficulty: z.number().int().nullable(),
    cpc: z.number().nullable(),
    competition: z.number().nullable(),
    trend: z.number().nullable(),
    intent: z.enum(SEARCH_INTENTS).nullable(),
  })
  .openapi('KeywordMetric');
export type KeywordMetric = z.infer<typeof KeywordMetric>;

export const ResearchBody = z
  .object({ org_id: z.string(), seed: z.string().min(1) })
  .openapi('ResearchBody');

export const ResearchResponse = z
  .object({ seed: KeywordMetric, similar: z.array(KeywordMetric) })
  .openapi('ResearchResponse');

export const SelectBody = z
  .object({ org_id: z.string(), keywords: z.array(KeywordMetric).min(1) })
  .openapi('SelectBody');

export const SelectResponse = z
  .object({ added: z.number().int(), skipped: z.number().int() })
  .openapi('SelectResponse');

export const ErrorResponse = z.object({ error: z.string() }).openapi('KeywordsError');
```

- [ ] **Step 4: Write the research route**

```ts
// apps/api/src/routes/keywords.ts
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { addCandidates } from '@shared/db';
import { DataForSeoError } from '@shared/providers';
import { getDataForSeoClient } from '../clients/providers';
import { loadOwnedPaidOrg, type OwnedPaidResult } from '../lib/load-owned-paid-org';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/keywords';

const RESEARCH_LIMIT = 20;

/** Map a loadOwnedPaidOrg failure to its HTTP status. */
function gateStatus(reason: Exclude<OwnedPaidResult, { ok: true }>['reason']): 404 | 403 | 402 {
  return reason === 'not_found' ? 404 : reason === 'not_owner' ? 403 : 402;
}

const keywords = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'post',
      path: '/research',
      summary: 'Manual keyword research (paid)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.ResearchBody } }, required: true },
      },
      responses: {
        200: { content: { 'application/json': { schema: schemas.ResearchResponse } }, description: 'Seed + similar keyword metrics' },
        402: { content: { 'application/json': { schema: schemas.ErrorResponse } }, description: 'Active paid entitlement required' },
        403: { content: { 'application/json': { schema: schemas.ErrorResponse } }, description: 'Not owned by the caller' },
        404: { content: { 'application/json': { schema: schemas.ErrorResponse } }, description: 'Org not found' },
        502: { content: { 'application/json': { schema: schemas.ErrorResponse } }, description: 'Keyword provider failure' },
      },
    }),
    async (c) => {
      const { org_id, seed } = c.req.valid('json');
      const { userId } = c.get('auth');
      const gate = await loadOwnedPaidOrg(org_id, userId);
      if (!gate.ok) return c.json({ error: gate.reason }, gateStatus(gate.reason));

      const loc = {
        locationName: gate.org.presets?.business.country,
        languageName: gate.org.presets?.business.language,
      };
      const df = getDataForSeoClient();
      try {
        const [seedMetrics, ideas] = await Promise.all([
          df.bulkKeywordDifficulty({ keywords: [seed], ...loc }),
          df.keywordIdeas({ keywords: [seed], limit: RESEARCH_LIMIT, ...loc }),
        ]);
        const seedMetric = seedMetrics[0] ?? {
          keyword: seed, search_volume: null, difficulty: null, cpc: null, competition: null, trend: null, intent: null,
        };
        const norm = seed.trim().toLowerCase();
        const similar = ideas.filter((m) => m.keyword.trim().toLowerCase() !== norm).slice(0, RESEARCH_LIMIT);
        return c.json({ seed: seedMetric, similar }, 200);
      } catch (err) {
        if (err instanceof DataForSeoError) return c.json({ error: 'keyword provider failed' }, 502);
        throw err;
      }
    },
  );

export default keywords;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- keywords`
Expected: PASS (both research tests).

- [ ] **Step 6: Mount the router**

In `apps/api/src/routes/index.ts`, import and add to the `routes` chain:

```ts
import keywords from './keywords';
// ...
const routes = app
  .route(`/api/${API_VERSION}/core`, core)
  .route(`/api/${API_VERSION}/setup`, setup)
  .route(`/api/${API_VERSION}/keywords`, keywords)
  .route(`/api/${API_VERSION}/dashboard`, dashboard);
```

- [ ] **Step 7: Typecheck (client chain) + commit**

Run: `npm run check:all`
Expected: PASS (web app still typechecks against `AppType`).

```bash
git add apps/api/src/schemas/keywords.ts apps/api/src/routes/keywords.ts apps/api/src/routes/index.ts apps/api/tests/keywords.test.ts
git commit -m "[api] POST /keywords/research — paid manual keyword research (#50)"
```

---

### Task B3: `POST /keywords/candidates` (selection)

**Files:**
- Modify: `apps/api/src/routes/keywords.ts`
- Modify: `apps/api/tests/keywords.test.ts`

**Interfaces:**
- Consumes: `addCandidates`, `loadOwnedPaidOrg`, `SelectBody`/`SelectResponse`.
- Produces: `POST /keywords/candidates` → `{ added, skipped }`.

- [ ] **Step 1: Add the failing test**

Append to `apps/api/tests/keywords.test.ts`:

```ts
const { addCandidates } = vi.hoisted(() => ({ addCandidates: vi.fn() }));
vi.mock('@shared/db', () => ({ addCandidates }));

describe('POST /candidates', () => {
  test('inserts selected keywords as manual candidates (pool only)', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce(paidOrg);
    addCandidates.mockResolvedValueOnce([{ id: 'c1' }]); // 1 of 2 inserted

    const res = await testClient(app).candidates.$post({
      json: {
        org_id: 'o1',
        keywords: [
          { keyword: 'best crm', search_volume: 300, difficulty: 30, cpc: 1, competition: 0.3, trend: 0, intent: 'commercial' },
          { keyword: 'crm pricing', search_volume: 200, difficulty: 20, cpc: 1, competition: 0.2, trend: 0, intent: 'commercial' },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1, skipped: 1 });
    const [orgId, items] = addCandidates.mock.calls[0];
    expect(orgId).toBe('o1');
    expect(items[0]).toMatchObject({ source: 'manual', status: 'candidate', keyword: 'best crm' });
  });

  test('402 for a free org, without touching the pool', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce({ ok: false, reason: 'not_paid' });
    const res = await testClient(app).candidates.$post({
      json: { org_id: 'o1', keywords: [{ keyword: 'x', search_volume: 1, difficulty: 1, cpc: null, competition: null, trend: null, intent: null }] },
    });
    expect(res.status).toBe(402);
    expect(addCandidates).not.toHaveBeenCalled();
  });
});
```

Note: move the existing `getDataForSeoClient` mock and the new `@shared/db` mock to the top of the file with the other `vi.mock` calls (Vitest hoists them regardless, but keep them grouped).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- keywords`
Expected: FAIL — no `candidates` route.

- [ ] **Step 3: Add the selection route**

Chain another `.openapi(...)` onto the `keywords` router (before `export default`):

```ts
  .openapi(
    createRoute({
      tags: ['keywords'],
      method: 'post',
      path: '/candidates',
      summary: 'Add selected keywords to the candidate pool (paid)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.SelectBody } }, required: true },
      },
      responses: {
        200: { content: { 'application/json': { schema: schemas.SelectResponse } }, description: 'Candidates inserted (deduped)' },
        402: { content: { 'application/json': { schema: schemas.ErrorResponse } }, description: 'Active paid entitlement required' },
        403: { content: { 'application/json': { schema: schemas.ErrorResponse } }, description: 'Not owned by the caller' },
        404: { content: { 'application/json': { schema: schemas.ErrorResponse } }, description: 'Org not found' },
      },
    }),
    async (c) => {
      const { org_id, keywords } = c.req.valid('json');
      const { userId } = c.get('auth');
      const gate = await loadOwnedPaidOrg(org_id, userId);
      if (!gate.ok) return c.json({ error: gate.reason }, gateStatus(gate.reason));

      const items = keywords.map((m) => ({
        org_id,
        keyword: m.keyword,
        source: 'manual' as const,
        status: 'candidate' as const,
        search_volume: m.search_volume,
        difficulty: m.difficulty,
        cpc: m.cpc,
        competition: m.competition,
        trend: m.trend,
        intent: m.intent,
      }));
      const inserted = await addCandidates(org_id, items);
      return c.json({ added: inserted.length, skipped: keywords.length - inserted.length }, 200);
    },
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- keywords && npm run check:all`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/keywords.ts apps/api/tests/keywords.test.ts
git commit -m "[api] POST /keywords/candidates — insert selected into pool only (#50)"
```

---

## PHASE C — #47 Auto 30-day strategy

### Task C1: Capture SERP competitors through the pipeline

**Files:**
- Modify: `packages/shared/keywords/src/types.ts`
- Modify: `packages/shared/keywords/src/serp.ts`
- Modify: `packages/shared/keywords/src/pipeline.ts`
- Test: `packages/shared/keywords/tests/serp-competitors.test.ts` (create)

**Interfaces:**
- Produces: `WorkingCandidate.serp_competitors: string[] | null` and same on `EnrichedCandidate`; accepted candidates carry the top-K organic domains.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/keywords/tests/serp-competitors.test.ts
import { describe, expect, test, vi } from 'vitest';
import { validateSerp } from '../src/serp';
import type { ResolvedConfig, WorkingCandidate } from '../src/types';

function candidate(keyword: string): WorkingCandidate {
  return {
    keyword, normalized: keyword, source: 'seed', source_context: null,
    search_volume: 100, difficulty: 10, cpc: null, competition: null, trend: null,
    intent: 'informational', relevance_score: 1, opportunity_score: 1,
    article_type: null, rejection_reason: null, status: 'candidate', serp_competitors: null,
  };
}

const config = {
  serpTopK: 3, serpDepth: 10, authorityDomains: [], authorityThreshold: 0.9,
  duplicateSerpOverlap: 0.9,
} as unknown as ResolvedConfig;

test('accepted candidates carry the top-K SERP domains', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi.fn(async () => [
      { rank: 1, url: 'https://a.com/1', domain: 'a.com', title: 'A' },
      { rank: 2, url: 'https://b.com/1', domain: 'b.com', title: 'B' },
      { rank: 3, url: 'https://c.com/1', domain: 'c.com', title: 'C' },
      { rank: 4, url: 'https://d.com/1', domain: 'd.com', title: 'D' },
    ]),
  };
  const llm = { complete: vi.fn(async () => ({ text: '{"intentSuitable":true,"localitySuitable":true}' })) };
  const presets = { business: { name: 'X' } } as never;

  const { accepted } = await validateSerp([candidate('best crm')], {
    dataForSeo: dataForSeo as never, llm: llm as never, presets, config,
  });
  expect(accepted[0].serp_competitors).toEqual(['a.com', 'b.com', 'c.com']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- serp-competitors`
Expected: FAIL — `serp_competitors` missing on the accepted candidate (or type error).

- [ ] **Step 3: Add the field to the types**

In `packages/shared/keywords/src/types.ts`, add `serp_competitors: string[] | null;` to **both** `WorkingCandidate` and `EnrichedCandidate` (after `rejection_reason`/`status` — keep them adjacent to the other nullable fields).

- [ ] **Step 4: Capture domains in `validateSerp`**

In `packages/shared/keywords/src/serp.ts`, when a candidate is accepted, attach the domains. Replace the accept branch:

```ts
    acceptedSerps.push(urls);
    accepted.push({ ...c, serp_competitors: serp.slice(0, config.serpTopK).map((r) => r.domain) });
```

- [ ] **Step 5: Thread it through `toEnriched`**

In `packages/shared/keywords/src/pipeline.ts`, add to the object returned by `toEnriched`:

```ts
    serp_competitors: c.serp_competitors,
```

Also ensure any place that constructs a fresh `WorkingCandidate` (gather/normalize) initializes `serp_competitors: null`. Run the typechecker (next step) to find them.

- [ ] **Step 6: Run tests + typecheck to verify**

Run: `npm test -- serp-competitors && npm run check`
Expected: PASS. Fix any `WorkingCandidate` construction sites the typechecker flags by adding `serp_competitors: null`.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/keywords/src/types.ts packages/shared/keywords/src/serp.ts packages/shared/keywords/src/pipeline.ts packages/shared/keywords/tests/serp-competitors.test.ts
git commit -m "[shared] Capture top-K SERP competitors on accepted candidates (#47)"
```

---

### Task C2: Cluster-spread scheduler (pure function)

**Files:**
- Create: `packages/shared/keywords/src/schedule.ts`
- Modify: `packages/shared/keywords/src/index.ts`
- Test: `packages/shared/keywords/tests/schedule.test.ts` (create)

**Interfaces:**
- Produces: `clusterSpreadSchedule<T extends { article_type: string | null }>(items: T[], startDate: Date, days?: number): Array<T & { scheduled_date: string }>` — assigns date-only strings across `days` (default 30), interleaving `article_type` groups so adjacent days differ where possible. Deterministic.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/keywords/tests/schedule.test.ts
import { describe, expect, test } from 'vitest';
import { clusterSpreadSchedule } from '../src/schedule';

const item = (id: number, type: string) => ({ id, article_type: type });

describe('clusterSpreadSchedule', () => {
  test('assigns consecutive dates from the start date', () => {
    const out = clusterSpreadSchedule([item(1, 'a'), item(2, 'b')], new Date('2026-07-08T00:00:00Z'), 30);
    expect(out.map((o) => o.scheduled_date)).toEqual(['2026-07-08', '2026-07-09']);
  });

  test('interleaves clusters so no two adjacent days share a type when possible', () => {
    const items = [item(1, 'a'), item(2, 'a'), item(3, 'b'), item(4, 'b')];
    const out = clusterSpreadSchedule(items, new Date('2026-07-08T00:00:00Z'), 30);
    const types = out.map((o) => o.article_type);
    for (let i = 1; i < types.length; i++) expect(types[i]).not.toBe(types[i - 1]);
  });

  test('is deterministic', () => {
    const items = [item(1, 'a'), item(2, 'b'), item(3, 'a')];
    const a = clusterSpreadSchedule(items, new Date('2026-07-08T00:00:00Z'));
    const b = clusterSpreadSchedule(items, new Date('2026-07-08T00:00:00Z'));
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- schedule`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the scheduler**

```ts
// packages/shared/keywords/src/schedule.ts

/** Date-only (yyyy-mm-dd) `offset` days after `start`, in UTC. */
function addDays(start: Date, offset: number): string {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Order `items` so same-`article_type` clusters are spread apart, then stamp a
 * consecutive `scheduled_date` on each (day 0..n-1 from `startDate`). Groups are
 * drained round-robin (largest first, stable) so adjacent days differ whenever
 * more than one group still has items. Deterministic. Caps at `days` items.
 */
export function clusterSpreadSchedule<T extends { article_type: string | null }>(
  items: T[],
  startDate: Date,
  days = 30,
): Array<T & { scheduled_date: string }> {
  const capped = items.slice(0, days);

  // Group by article_type (null -> 'other'), preserving input order within a group.
  const groups = new Map<string, T[]>();
  for (const it of capped) {
    const key = it.article_type ?? 'other';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
  }

  // Round-robin drain: each pass, take one from every non-empty group, largest
  // remaining first (stable by group key) so big clusters don't bunch at the end.
  const ordered: T[] = [];
  while (ordered.length < capped.length) {
    const nonEmpty = [...groups.entries()]
      .filter(([, arr]) => arr.length > 0)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    let prev = ordered.length ? (ordered[ordered.length - 1].article_type ?? 'other') : null;
    // Prefer a different group than the previous day; fall back to any.
    const pick = nonEmpty.find(([key]) => key !== prev) ?? nonEmpty[0];
    ordered.push(pick[1].shift()!);
  }

  return ordered.map((it, i) => ({ ...it, scheduled_date: addDays(startDate, i) }));
}
```

Add to `packages/shared/keywords/src/index.ts`:

```ts
export { clusterSpreadSchedule } from './schedule';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- schedule`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/keywords/src/schedule.ts packages/shared/keywords/src/index.ts packages/shared/keywords/tests/schedule.test.ts
git commit -m "[shared] clusterSpreadSchedule — spread clusters across 30 days (#47)"
```

---

### Task C3: StrategyTask + enqueue + finalize trigger

**Files:**
- Modify: `packages/shared/schemas/src/scan.ts`
- Modify: `apps/api/src/clients/sqs.ts`
- Modify: `apps/api/src/routes/setup.ts`
- Modify: `apps/api/tests/setup.test.ts`

**Interfaces:**
- Produces: `StrategyTask` schema `{ org_id }`; `enqueueStrategyTask(task: StrategyTask): Promise<void>`; `/setup/finalize` enqueues exactly one strategy task iff `isPaid(org) && claimStrategy` won.

- [ ] **Step 1: Add the failing finalize test**

Append to `apps/api/tests/setup.test.ts` a strategy trigger block. First extend the existing `@shared/db` mock's `OrgRepo` with `finalize`, `claimStrategy`, and make `findById` return a paid org for a new id `paid_ready`. Then:

```ts
// At top with the other hoisted spies:
const { enqueueStrategyTask } = vi.hoisted(() => ({ enqueueStrategyTask: vi.fn(async () => {}) }));
// Merge into the existing vi.mock('../src/clients/sqs', ...) factory:
//   ({ enqueueScanTask, enqueueStrategyTask })

describe('POST /finalize strategy trigger', () => {
  test('paid org: claims and enqueues exactly one strategy job', async () => {
    // findById('paid_ready') returns setup_scan_completed + presets + plan 'paid'
    // claimStrategy resolves true
    const res = await finalize('paid_ready'); // helper posts /finalize with valid body
    expect(res.status).toBe(200);
    expect(enqueueStrategyTask).toHaveBeenCalledTimes(1);
    expect(enqueueStrategyTask.mock.calls[0][0]).toEqual({ org_id: 'paid_ready' });
  });

  test('free org: does not enqueue', async () => {
    const res = await finalize('6650f1a2b3c4d5e6f7a8b9c0'); // existing free fixture
    expect(res.status).toBe(200);
    expect(enqueueStrategyTask).not.toHaveBeenCalled();
  });

  test('paid org, claim lost: does not enqueue', async () => {
    // claimStrategy resolves false for this run
    const res = await finalize('paid_ready');
    expect(res.status).toBe(200);
    expect(enqueueStrategyTask).not.toHaveBeenCalled();
  });
});
```

Wire the fixtures: in the mocked `OrgRepo`, add `finalize: vi.fn(async () => {})`, `claimStrategy: vi.fn(async () => true)`, and a `findById` branch for `paid_ready` returning `{ ..., plan: 'paid', setup_status: 'setup_scan_completed', presets: presetsFixture }`. Give existing fixtures `plan: 'free'`. Implement a `finalize(orgId)` helper in the test that calls the finalize route via `app.request` with the standard body. For the "claim lost" test, `claimStrategy.mockResolvedValueOnce(false)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- setup`
Expected: FAIL — `enqueueStrategyTask` undefined / not called.

- [ ] **Step 3: Add `StrategyTask` schema**

Append to `packages/shared/schemas/src/scan.ts`:

```ts
/**
 * Strategy task message — the contract on the SQS strategy queue between the API
 * (producer, POST /setup/finalize for paid orgs) and the strategy worker.
 */
export const StrategyTask = z.object({
  org_id: z.string(),
});
export type StrategyTask = z.infer<typeof StrategyTask>;
```

- [ ] **Step 4: Add the SQS producer**

In `apps/api/src/clients/sqs.ts`, add:

```ts
import type { ScanTask, StrategyTask } from '@shared/schemas';
// ...existing enqueueScanTask...

/** Enqueue a 30-day strategy task for the strategy worker (#47). */
export async function enqueueStrategyTask(task: StrategyTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.STRATEGY_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
```

- [ ] **Step 5: Trigger from `/setup/finalize`**

In `apps/api/src/routes/setup.ts`: import `isPaid` from `@shared/schemas` and `enqueueStrategyTask`. Replace the finalize handler tail (after `await OrgRepo.finalize(org_id, merged);`):

```ts
      await OrgRepo.finalize(org_id, merged);
      // Paid orgs get an automatic 30-day strategy. claimStrategy guarantees
      // exactly one job across finalize retries / re-finalize (#47).
      if (isPaid(org) && (await OrgRepo.claimStrategy(org_id))) {
        await enqueueStrategyTask({ org_id });
      }
      return c.json({ setup_status: 'setup_complete' as const, presets: merged }, 200);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- setup && npm run check:all`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/schemas/src/scan.ts apps/api/src/clients/sqs.ts apps/api/src/routes/setup.ts apps/api/tests/setup.test.ts
git commit -m "[api] Enqueue strategy job on paid finalize (idempotent claim) (#47)"
```

---

### Task C4: Strategy worker

**Files:**
- Modify: `apps/worker/package.json` (add `@shared/keywords`, `@shared/providers`)
- Create: `apps/worker/src/providers.ts`
- Create: `apps/worker/src/strategy.ts`
- Modify: `apps/worker/src/dev.ts`
- Test: `apps/worker/tests/strategy.test.ts` (create)

**Interfaces:**
- Consumes: `StrategyTask`, `OrgRepo`, `addCandidates`, `KeywordRepo.create`, `CandidateRepo`, `runKeywordPipeline`, `clusterSpreadSchedule`, provider factories.
- Produces: `handler: SQSHandler` (exported from `apps/worker/src/strategy.ts`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/tests/strategy.test.ts
import type { SQSEvent } from 'aws-lambda';
import { describe, expect, test, vi } from 'vitest';

const { findById, setStrategyStatus, addCandidates, createKeyword, listByOrg, setStatus } = vi.hoisted(() => ({
  findById: vi.fn(),
  setStrategyStatus: vi.fn(async () => {}),
  addCandidates: vi.fn(async () => []),
  createKeyword: vi.fn(async () => ({})),
  listByOrg: vi.fn(async () => []),
  setStatus: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById, setStrategyStatus },
  KeywordRepo: { create: createKeyword },
  CandidateRepo: { listByOrg, setStatus },
  addCandidates,
}));

const { runKeywordPipeline } = vi.hoisted(() => ({ runKeywordPipeline: vi.fn() }));
vi.mock('@shared/keywords', async (orig) => ({
  ...(await orig<typeof import('@shared/keywords')>()),
  runKeywordPipeline,
}));

vi.mock('../src/providers', () => ({
  getStrategyClients: () => ({ dataForSeo: {}, llm: {} }),
}));

import { handler } from '../src/strategy';

function event(body: unknown): SQSEvent {
  return { Records: [{ messageId: '1', receiptHandle: 'rh', body: JSON.stringify(body), attributes: {} as never, messageAttributes: {}, md5OfBody: '', eventSource: 'aws:sqs', eventSourceARN: 'arn', awsRegion: 'us-east-1' }] };
}

const org = {
  id: 'o1', user_id: 'u1', website_url: 'https://example.com',
  setup_status: 'setup_complete', plan: 'paid', strategy_status: 'pending',
  presets: { business: { name: 'X', language: 'English', country: 'Global (English)' }, audience: { target: 'devs', competitors: [] } },
  created_at: new Date(),
};

function candidate(kw: string, score: number) {
  return { org_id: 'o1', keyword: kw, source: 'seed', source_context: null, search_volume: 100, difficulty: 10, cpc: null, competition: null, trend: null, intent: 'informational', relevance_score: 1, opportunity_score: score, article_type: 'how_to_guide', rejection_reason: null, status: 'candidate', serp_competitors: ['a.com'] };
}

describe('strategy worker', () => {
  test('runs pipeline, schedules top candidates, completes', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]); // no existing scheduled keywords
    runKeywordPipeline.mockResolvedValue({
      candidates: [candidate('a', 0.9), candidate('b', 0.8), candidate('rejected', 0.5)].map((c, i) =>
        i === 2 ? { ...c, rejection_reason: 'serp_intent' } : c,
      ),
      stats: {},
    });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(addCandidates).toHaveBeenCalledTimes(1);
    expect(createKeyword).toHaveBeenCalledTimes(2); // rejected one excluded
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'completed');
  });

  test('skips when already completed (idempotent)', async () => {
    findById.mockResolvedValue({ ...org, strategy_status: 'completed' });
    await handler(event({ org_id: 'o1' }), {} as never, () => {});
    expect(runKeywordPipeline).not.toHaveBeenCalled();
    expect(createKeyword).not.toHaveBeenCalled();
  });

  test('marks failed and rethrows on pipeline error', async () => {
    findById.mockResolvedValue(org);
    runKeywordPipeline.mockRejectedValue(new Error('provider down'));
    await expect(handler(event({ org_id: 'o1' }), {} as never, () => {})).rejects.toThrow('provider down');
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- strategy`
Expected: FAIL — `../src/strategy` / `../src/providers` not found.

- [ ] **Step 3: Add worker deps**

In `apps/worker/package.json`, add to dependencies: `"@shared/keywords": "*"`, `"@shared/providers": "*"`. Run `npm install`.

- [ ] **Step 4: Provider factories for the worker**

```ts
// apps/worker/src/providers.ts
import { createDataForSeoClient, createOpenRouterClient } from '@shared/providers';

/** Build the DataForSEO + LLM clients the strategy pipeline needs, from env. */
export function getStrategyClients() {
  return {
    dataForSeo: createDataForSeoClient({
      login: process.env.DATAFORSEO_LOGIN ?? '',
      password: process.env.DATAFORSEO_PASSWORD ?? '',
    }),
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
  };
}
```

- [ ] **Step 5: Implement the strategy handler**

```ts
// apps/worker/src/strategy.ts
import { addCandidates, CandidateRepo, KeywordRepo, OrgRepo } from '@shared/db';
import { clusterSpreadSchedule, runKeywordPipeline } from '@shared/keywords';
import { normalizeKeyword, StrategyTask } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getStrategyClients } from './providers';

const PLAN_DAYS = 30;

/**
 * Strategy worker — triggered by SQS (enqueued from POST /setup/finalize for
 * paid orgs). Runs the keyword pipeline, persists candidates, and schedules up
 * to 30 non-overlapping planner entries spread across 30 days. Idempotent:
 * skips if already completed; on failure marks the org and rethrows so SQS
 * redelivers (-> DLQ). See design/product-flow.md and epic #56.
 */
export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    let orgId: string | undefined;
    try {
      const task = StrategyTask.parse(JSON.parse(record.body));
      orgId = task.org_id;
      logger.appendKeys({ org_id: orgId });

      const org = await OrgRepo.findById(orgId);
      if (!org || !org.presets) {
        logger.warn('strategy skipped: org or presets missing');
        continue;
      }
      if (org.strategy_status === 'completed') {
        logger.info('strategy already completed; skipping');
        continue;
      }

      const clients = getStrategyClients();
      const scheduled = await KeywordRepo.listByOrg(orgId);
      const scheduledKeywords = scheduled.map((k) => k.keyword);
      const articleKeywords: string[] = []; // ArticleRepo has none until #55 generates

      const result = await runKeywordPipeline({
        orgId,
        websiteUrl: org.website_url,
        presets: org.presets,
        competitors: org.presets.audience.competitors,
        existingKeywords: scheduledKeywords,
        existingArticleKeywords: articleKeywords,
        clients,
      });

      await addCandidates(orgId, result.candidates);

      // Select schedulable candidates: accepted (no rejection), real metrics,
      // not already on the planner. Rank by opportunity_score desc, stable.
      const scheduledSet = new Set(scheduled.map((k) => normalizeKeyword(k.keyword)));
      const selectable = result.candidates
        .filter(
          (c) =>
            c.rejection_reason === null &&
            c.search_volume !== null &&
            c.difficulty !== null &&
            !scheduledSet.has(normalizeKeyword(c.keyword)),
        )
        .sort(
          (a, b) =>
            (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0) ||
            normalizeKeyword(a.keyword).localeCompare(normalizeKeyword(b.keyword)),
        )
        .slice(0, PLAN_DAYS);

      const plan = clusterSpreadSchedule(selectable, new Date(), PLAN_DAYS);
      for (const c of plan) {
        await KeywordRepo.create({
          org_id: orgId,
          keyword: c.keyword,
          status: 'scheduled',
          scheduled_date: c.scheduled_date,
          search_volume: c.search_volume as number,
          difficulty: c.difficulty as number,
          article_id: null,
          article_type: c.article_type,
          intent: c.intent,
          opportunity_score: c.opportunity_score,
          serp_competitors: c.serp_competitors,
        });
        const stored = await CandidateRepo.findByNormalized(orgId, normalizeKeyword(c.keyword));
        if (stored) await CandidateRepo.setStatus(stored.id, 'selected');
      }

      await OrgRepo.setStrategyStatus(orgId, 'completed');
      logger.info('strategy completed', { scheduled: plan.length });
    } catch (err) {
      if (orgId) await OrgRepo.setStrategyStatus(orgId, 'failed').catch(() => {});
      logger.error('strategy failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id']);
    }
  }
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- strategy && npm run check`
Expected: PASS (3 tests). If the pipeline import in the test needs `runKeywordPipeline` overridden only, the partial mock in Step 1 handles it.

- [ ] **Step 7: Local dev poller**

`apps/worker/src/dev.ts` is currently a single top-level loop bound to `SCAN_QUEUE_URL`. Refactor it into a reusable `pollQueue` and run both queues concurrently. Replace the file body below line 25 (keep the imports + `sqs`/`endpoint` setup; drop the `queueUrl` const and its guard) with:

```ts
import type { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda';
import { handler as scanHandler } from './index';
import { handler as strategyHandler } from './strategy';

function toRecord(queueUrl: string, body: string, id: string, receiptHandle: string): SQSRecord {
  return {
    messageId: id, receiptHandle, body,
    attributes: {} as never, messageAttributes: {}, md5OfBody: '',
    eventSource: 'aws:sqs', eventSourceARN: queueUrl, awsRegion: 'local',
  };
}

async function pollQueue(name: string, queueUrl: string, handler: SQSHandler): Promise<never> {
  console.log(`[worker:${name}] polling ${queueUrl}`);
  for (;;) {
    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 5, WaitTimeSeconds: 5 }),
    );
    if (!Messages?.length) continue;
    const records = Messages.map((m, i) =>
      toRecord(queueUrl, m.Body ?? '', m.MessageId ?? String(i), m.ReceiptHandle ?? ''),
    );
    const event: SQSEvent = { Records: records };
    try {
      await handler(event, {} as never, () => {});
      for (const m of Messages) {
        if (m.ReceiptHandle) {
          await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }));
        }
      }
      console.log(`[worker:${name}] processed ${records.length} message(s)`);
    } catch (err) {
      console.error(`[worker:${name}] handler failed; messages will be redelivered`, err);
    }
  }
}

const scanUrl = process.env.SCAN_QUEUE_URL;
const strategyUrl = process.env.STRATEGY_QUEUE_URL;
if (!scanUrl) throw new Error('SCAN_QUEUE_URL is required for the local worker poller');

const pollers = [pollQueue('scan', scanUrl, scanHandler)];
if (strategyUrl) pollers.push(pollQueue('strategy', strategyUrl, strategyHandler));
await Promise.all(pollers);
```

Add `STRATEGY_QUEUE_URL` to the local ElasticMQ setup and `apps/worker/.env` (or root `.env`) alongside `SCAN_QUEUE_URL`, and ensure the local queue is created (mirror however `SCAN_QUEUE_URL`'s ElasticMQ queue is provisioned — check `docker-compose`/elasticmq config).

- [ ] **Step 8: Commit**

```bash
git add apps/worker/package.json package-lock.json apps/worker/src/providers.ts apps/worker/src/strategy.ts apps/worker/src/dev.ts apps/worker/tests/strategy.test.ts
git commit -m "[worker] Strategy worker: pipeline -> candidates -> 30-day plan (#47)"
```

---

### Task C5: Infra — strategy queue + worker Lambda

**Files:**
- Modify: `infra/lib/api-stack.ts`
- Test: `cd infra && npm run build` (CDK typecheck) + `npx cdk synth` (no deploy).

**Interfaces:**
- Produces: `StrategyQueue` + `StrategyDlq`; `STRATEGY_QUEUE_URL` env on the API Lambda (+ send grant); a `StrategyWorkerFn` NodejsFunction wired to the strategy queue with Mongo + provider env; provider secret env vars on both API and strategy worker.

- [ ] **Step 1: Add the queue, DLQ, and env**

In `infra/lib/api-stack.ts`, after the scan queue block, add:

```ts
    const strategyDlq = new Queue(this, 'StrategyDlq', {
      retentionPeriod: Duration.days(14),
    });
    const strategyQueue = new Queue(this, 'StrategyQueue', {
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: { queue: strategyDlq, maxReceiveCount: 3 },
    });
```

(Match the exact `Duration`/import style already in the file.)

- [ ] **Step 2: Grant the API send + env**

Add `STRATEGY_QUEUE_URL: strategyQueue.queueUrl` to the `apiFn` environment object and `strategyQueue.grantSendMessages(apiFn);` next to the existing `scanQueue.grantSendMessages(apiFn);`.

Add provider secret env vars (read from `process.env` at deploy host / CI; deployed-secret provisioning is deferred per the spec) to the `apiFn` environment:

```ts
      DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN ?? '',
      DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD ?? '',
```

- [ ] **Step 3: Add the strategy worker Lambda**

After the scanner `workerFn` block:

```ts
    const strategyWorkerFn = new NodejsFunction(this, 'StrategyWorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/strategy.ts'),
      // ...copy runtime/architecture/bundling/handler/timeout/memory from workerFn,
      //    but use a timeout suited to the pipeline (e.g. Duration.minutes(10))...
      timeout: Duration.minutes(10),
      environment: {
        ...mongoEnv,
        DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN ?? '',
        DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD ?? '',
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
      },
    });
    strategyWorkerFn.addEventSource(new SqsEventSource(strategyQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(strategyWorkerFn);
```

Keep the strategy worker's visibility timeout ≥ its Lambda timeout (the queue is 15 min; the Lambda is 10 min — OK).

- [ ] **Step 4: Typecheck + synth**

Run: `cd infra && npm install && npm run build && npx cdk synth SeoApiStack-staging`
Expected: synth succeeds; the template shows `StrategyQueue`, `StrategyDlq`, and `StrategyWorkerFn`.

- [ ] **Step 5: Commit**

```bash
git add infra/lib/api-stack.ts
git commit -m "[infra] Strategy queue + DLQ + strategy worker Lambda (#47)"
```

---

## Final verification

- [ ] Run the full gates:

```bash
npm run lint && npm run check:all && npm test
docker compose up -d mongo && npm run test:integration
```

Expected: all green.

- [ ] Update `PROGRESS.md`: flip the keyword-pipeline line to note #50 (manual research API) and #47 (auto strategy) are wired; keep it one line + issue links. Commit.

- [ ] Open a PR into `dev` with body: `Part of #56. Closes #50. Closes #47.` (only include `Closes` for whichever are fully landed and tested; leave open anything with a real remainder — e.g. if deployed-env provider secrets are still unprovisioned, note it and keep #47 open).

---

## Self-Review notes (addressed)

- **Spec coverage:** §1→A1/A5, §2→A3, §3→B2/B3, §4→C1, §5→C2/C3/C4/C5. All covered.
- **Type consistency:** `loadOwnedPaidOrg` result shape identical in A5, B2, B3; `clusterSpreadSchedule` signature identical in C2 and C4; `StrategyTask` `{ org_id }` identical in C3 and C4; `getStrategyClients` name identical in C4 test + impl.
- **Deferred (explicit):** deployed-env provider secret provisioning (manual, tracked with #9/#43); LLM briefs/outlines (#55); true cluster-id spread (uses `article_type` proxy).
- **Known follow-up for the implementer:** in Task C4 Step 7 and C5 Step 3, inspect the existing `dev.ts` poller / `workerFn` construct and mirror them rather than inventing shapes — the surrounding code is the source of truth.
