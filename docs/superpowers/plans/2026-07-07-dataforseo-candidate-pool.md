# DataForSEO client + keyword candidate pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tested DataForSEO HTTP client and an org-scoped keyword *candidate pool* (schema, repository, indexes), separate from the scheduled `keywords`/planner collection — issue #49.

**Architecture:** A new `@shared/providers` workspace package holds a real DataForSEO client behind typed methods with normalized, credential-free errors and timeout/retry. `@shared/schemas` gains a `CandidateSchema` (+ `normalizeKeyword`), `@shared/db` gains `CandidateRepo`, and `ensureIndexes()` gains the candidate indexes. No consumer wiring this session — the client takes injected credentials.

**Tech Stack:** TypeScript 6, Zod 4, mongodb 7, Vitest 4, npm workspaces. Biome for lint/format.

## Global Constraints

- Shared packages export TS source only: `"type": "module"`, `"main": "src/index.ts"`, `"sideEffects": false`, `"exports": { ".": "./src/index.ts" }`; internal deps use `"*"` (no `workspace:`). No per-package `tsconfig.json` — the root `tsconfig.json` globs `packages/shared/*/src/**/*` and `packages/shared/*/tests/**/*`.
- `verbatimModuleSyntax` is on: use `import type` / `export type` for type-only imports.
- Unit tests: `packages/**/tests/**/*.test.ts` (run by `npm test`, no infra). Integration tests: `packages/**/tests/**/*.integration.test.ts` (run by `npm run test:integration`, needs `docker compose up -d mongo`).
- Repositories validate through Zod at the boundary and map Mongo `_id` ↔ string `id`; app code never touches the driver directly.
- Candidates live in their own `candidates` collection — never touch the existing `keywords` collection/schema.
- Never place DataForSEO credentials or the `Authorization` header into any error message, log, or thrown value.
- Zod defaults: `z.enum(...).default(...)` and `z.number().nullable().default(null)` are used so `CreateCandidateInput` requires only `keyword` + `source`.
- Verification commands: `npm run lint:fix`, `npm run check` (root tsc), `npm test`, `npm run test:integration`.

---

### Task 1: Candidate schema + `normalizeKeyword` (`@shared/schemas`)

**Files:**
- Create: `packages/shared/schemas/src/candidate.ts`
- Modify: `packages/shared/schemas/src/index.ts` (add `export * from './candidate';`)
- Test: `packages/shared/schemas/tests/candidate.test.ts`

**Interfaces:**
- Produces:
  - `normalizeKeyword(raw: string): string`
  - `SEARCH_INTENTS`, `type SearchIntent = 'informational' | 'commercial' | 'transactional' | 'navigational'`
  - `CANDIDATE_SOURCES`, `CANDIDATE_STATUSES`
  - `CandidateSchema` / `type Candidate`
  - `CreateCandidateInput` (schema + `type`), omitting `id`, `normalized_keyword`, `created_at`, `updated_at`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schemas/tests/candidate.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  CandidateSchema,
  CreateCandidateInput,
  normalizeKeyword,
} from '../src';

describe('normalizeKeyword', () => {
  test('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeKeyword('  Best   SEO  Tools ')).toBe('best seo tools');
  });
});

describe('CandidateSchema', () => {
  test('parses a full candidate with nullable metrics and scores', () => {
    const c = CandidateSchema.parse({
      id: 'c1',
      org_id: 'o1',
      keyword: 'notion seo',
      normalized_keyword: 'notion seo',
      source: 'keyword_ideas',
      source_context: null,
      search_volume: 170,
      difficulty: 36,
      cpc: 1.2,
      competition: 0.4,
      trend: null,
      intent: 'informational',
      relevance_score: null,
      opportunity_score: null,
      status: 'candidate',
      created_at: new Date(),
      updated_at: new Date(),
    });
    expect(c.opportunity_score).toBeNull();
    expect(c.intent).toBe('informational');
  });
});

describe('CreateCandidateInput', () => {
  test('requires only keyword + source; defaults the rest', () => {
    const parsed = CreateCandidateInput.parse({
      org_id: 'o1',
      keyword: 'seo tools',
      source: 'manual',
    });
    expect(parsed.status).toBe('candidate');
    expect(parsed.search_volume).toBeNull();
    expect(parsed.opportunity_score).toBeNull();
  });

  test('omits server-assigned + derived fields', () => {
    expect('id' in CreateCandidateInput.shape).toBe(false);
    expect('normalized_keyword' in CreateCandidateInput.shape).toBe(false);
    expect('created_at' in CreateCandidateInput.shape).toBe(false);
    expect('updated_at' in CreateCandidateInput.shape).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- candidate`
Expected: FAIL — cannot resolve `normalizeKeyword` / `CandidateSchema` from `../src`.

- [ ] **Step 3: Write the schema**

Create `packages/shared/schemas/src/candidate.ts`:

```ts
import { z } from 'zod';

/** Provenance of a candidate keyword. */
export const CANDIDATE_SOURCES = [
  'keywords_for_site',
  'ranked_keywords',
  'keyword_ideas',
  'serp',
  'manual',
  'seed',
] as const;

/** Candidate lifecycle. Scoring/rejection reasons are added in #54. */
export const CANDIDATE_STATUSES = ['candidate', 'selected', 'rejected'] as const;

/** Search intent, shared with the DataForSEO client's normalization. */
export const SEARCH_INTENTS = [
  'informational',
  'commercial',
  'transactional',
  'navigational',
] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];

/** Canonical dedup key: lowercased, trimmed, whitespace-collapsed. */
export function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Candidate keyword — an org-scoped opportunity in the candidate pool, distinct
 * from the scheduled `keywords`/planner collection. Scoring fields
 * (`relevance_score`, `opportunity_score`) are populated later by #54.
 * See docs/superpowers/specs/2026-07-07-dataforseo-candidate-pool-design.md.
 */
export const CandidateSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword: z.string(),
  // Derived from `keyword` by the repository; unique per org.
  normalized_keyword: z.string(),
  source: z.enum(CANDIDATE_SOURCES),
  source_context: z.string().nullable().default(null),
  search_volume: z.number().int().nullable().default(null),
  difficulty: z.number().int().nullable().default(null),
  cpc: z.number().nullable().default(null),
  competition: z.number().nullable().default(null),
  trend: z.number().nullable().default(null),
  intent: z.enum(SEARCH_INTENTS).nullable().default(null),
  relevance_score: z.number().nullable().default(null),
  opportunity_score: z.number().nullable().default(null),
  status: z.enum(CANDIDATE_STATUSES).default('candidate'),
  created_at: z.date(),
  updated_at: z.date(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/**
 * Input for creating a candidate. `id`/`created_at`/`updated_at` are
 * server-assigned; `normalized_keyword` is derived by the repository.
 */
export const CreateCandidateInput = CandidateSchema.omit({
  id: true,
  normalized_keyword: true,
  created_at: true,
  updated_at: true,
});
export type CreateCandidateInput = z.infer<typeof CreateCandidateInput>;
```

- [ ] **Step 4: Export from the package index**

Modify `packages/shared/schemas/src/index.ts` — add the line (keep alphabetical order, before `./keyword`):

```ts
export * from './candidate';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- candidate`
Expected: PASS (3 tests).

- [ ] **Step 6: Lint + typecheck**

Run: `npm run lint:fix && npm run check`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/schemas/src/candidate.ts packages/shared/schemas/src/index.ts packages/shared/schemas/tests/candidate.test.ts
git commit -m "$(cat <<'EOF'
[dashboard] Add Candidate schema + normalizeKeyword

Org-scoped candidate-pool entity, separate from scheduled keywords.
Scoring fields are nullable placeholders filled by #54.

Part of #49

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `CandidateRepo` + candidate indexes (`@shared/db`)

**Files:**
- Create: `packages/shared/db/src/repositories/candidate.repo.ts`
- Modify: `packages/shared/db/src/index.ts` (export `CandidateRepo`)
- Modify: `packages/shared/db/src/ensure-indexes.ts` (add 3 candidate indexes)
- Test: `packages/shared/db/tests/candidate.repo.integration.test.ts`

**Interfaces:**
- Consumes: `CandidateSchema`, `CreateCandidateInput`, `normalizeKeyword`, `type Candidate`, `type CandidateStatus` from `@shared/schemas`; `ensureIndexes` from `../src/ensure-indexes`.
- Produces `CandidateRepo` with:
  - `insertMany(orgId: string, items: CreateCandidateInput[]): Promise<Candidate[]>` — derives `normalized_keyword`, dedupes within the batch and against existing rows, returns only newly inserted candidates.
  - `listByOrg(orgId: string, opts?: { status?: Candidate['status'] }): Promise<Candidate[]>`
  - `findByNormalized(orgId: string, normalized: string): Promise<Candidate | null>`
  - `setStatus(id: string, status: Candidate['status']): Promise<void>`

- [ ] **Step 1: Write the failing integration test**

Create `packages/shared/db/tests/candidate.repo.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { CandidateRepo } from '../src/repositories/candidate.repo';

/**
 * Real-MongoDB round-trip. Run with `npm run test:integration` after
 * `docker compose up -d mongo`.
 */
describe('CandidateRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('candidates').deleteMany({});
    await ensureIndexes(); // unique (org_id, normalized_keyword) drives dedup
  });

  afterAll(async () => {
    await closeDb();
  });

  test('insertMany derives normalized_keyword and dedupes within batch', async () => {
    const inserted = await CandidateRepo.insertMany('org_cand', [
      { org_id: 'org_cand', keyword: 'Best SEO Tools', source: 'keyword_ideas' },
      { org_id: 'org_cand', keyword: 'best   seo tools', source: 'manual' }, // dup
      { org_id: 'org_cand', keyword: 'notion seo', source: 'manual' },
    ]);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]!.normalized_keyword).toBe('best seo tools');
    expect(inserted[0]!.id).toMatch(/^[a-f0-9]{24}$/);
    expect(inserted[0]!.status).toBe('candidate');
  });

  test('insertMany dedupes against already-stored candidates', async () => {
    const again = await CandidateRepo.insertMany('org_cand', [
      { org_id: 'org_cand', keyword: 'BEST seo tools', source: 'serp' }, // exists
      { org_id: 'org_cand', keyword: 'seo audit', source: 'seed' }, // new
    ]);
    expect(again.map((c) => c.keyword)).toEqual(['seo audit']);
  });

  test('findByNormalized + cross-org isolation', async () => {
    expect(await CandidateRepo.findByNormalized('org_cand', 'notion seo')).not.toBeNull();
    expect(await CandidateRepo.findByNormalized('other_org', 'notion seo')).toBeNull();
  });

  test('listByOrg filters by status', async () => {
    const all = await CandidateRepo.listByOrg('org_cand');
    expect(all.length).toBe(3);
    expect(await CandidateRepo.listByOrg('org_cand', { status: 'selected' })).toHaveLength(0);
  });

  test('setStatus transitions and bumps updated_at', async () => {
    const [first] = await CandidateRepo.listByOrg('org_cand');
    const before = first!.updated_at.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await CandidateRepo.setStatus(first!.id, 'selected');
    const selected = await CandidateRepo.listByOrg('org_cand', { status: 'selected' });
    expect(selected).toHaveLength(1);
    expect(selected[0]!.id).toBe(first!.id);
    expect(selected[0]!.updated_at.getTime()).toBeGreaterThan(before);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose up -d mongo && npm run test:integration -- candidate`
Expected: FAIL — cannot resolve `../src/repositories/candidate.repo`.

- [ ] **Step 3: Write the repository**

Create `packages/shared/db/src/repositories/candidate.repo.ts`:

```ts
import {
  type Candidate,
  CandidateSchema,
  type CreateCandidateInput,
  CreateCandidateInput as CreateCandidateInputSchema,
  normalizeKeyword,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('candidates');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Candidate {
  const { _id, ...rest } = doc;
  return CandidateSchema.parse({ id: _id.toString(), ...rest });
}

export const CandidateRepo = {
  /**
   * Insert candidates for an org, deriving `normalized_keyword` and deduping
   * both within the batch and against already-stored candidates. Returns only
   * the newly inserted candidates.
   */
  async insertMany(orgId: string, items: CreateCandidateInput[]): Promise<Candidate[]> {
    if (items.length === 0) return [];

    // Validate + derive normalized key.
    const prepared = items.map((item) => {
      const data = CreateCandidateInputSchema.parse({ ...item, org_id: orgId });
      return { ...data, normalized_keyword: normalizeKeyword(data.keyword) };
    });

    // Dedupe within the batch (keep first occurrence).
    const seen = new Set<string>();
    const batch = prepared.filter(
      (p) => !seen.has(p.normalized_keyword) && seen.add(p.normalized_keyword),
    );

    const col = await collection();
    const existing = await col
      .find(
        { org_id: orgId, normalized_keyword: { $in: batch.map((b) => b.normalized_keyword) } },
        { projection: { normalized_keyword: 1 } },
      )
      .toArray();
    const existingSet = new Set(existing.map((e) => e.normalized_keyword as string));

    const toInsert = batch.filter((b) => !existingSet.has(b.normalized_keyword));
    if (toInsert.length === 0) return [];

    const now = new Date();
    const docs = toInsert.map((d) => ({ ...d, created_at: now, updated_at: now }));
    const res = await col.insertMany(docs, { ordered: false });
    return docs.map((d, i) => toEntity({ _id: res.insertedIds[i]!, ...d }));
  },

  async listByOrg(
    orgId: string,
    opts: { status?: Candidate['status'] } = {},
  ): Promise<Candidate[]> {
    const query: Document = { org_id: orgId };
    if (opts.status) query.status = opts.status;
    const docs = await (await collection())
      .find(query)
      .sort({ opportunity_score: -1, created_at: 1 })
      .toArray();
    return docs.map(toEntity);
  },

  async findByNormalized(orgId: string, normalized: string): Promise<Candidate | null> {
    const doc = await (await collection()).findOne({
      org_id: orgId,
      normalized_keyword: normalized,
    });
    return doc ? toEntity(doc) : null;
  },

  async setStatus(id: string, status: Candidate['status']): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updated_at: new Date() } },
    );
  },
};
```

- [ ] **Step 4: Add candidate indexes**

Modify `packages/shared/db/src/ensure-indexes.ts` — add these three lines before the closing `}` of `ensureIndexes`, after the `articles` indexes:

```ts
  await db
    .collection('candidates')
    .createIndex({ org_id: 1, normalized_keyword: 1 }, { unique: true });
  await db.collection('candidates').createIndex({ org_id: 1, status: 1 });
  await db.collection('candidates').createIndex({ org_id: 1, opportunity_score: -1 });
```

- [ ] **Step 5: Export the repo**

Modify `packages/shared/db/src/index.ts` — add (keep alphabetical, before `ArticleRepo`... insert after `ensureIndexes` export line):

```ts
export { CandidateRepo } from './repositories/candidate.repo';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm run test:integration -- candidate`
Expected: PASS (5 tests).

- [ ] **Step 7: Lint + typecheck**

Run: `npm run lint:fix && npm run check`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/db/src/repositories/candidate.repo.ts packages/shared/db/src/index.ts packages/shared/db/src/ensure-indexes.ts packages/shared/db/tests/candidate.repo.integration.test.ts
git commit -m "$(cat <<'EOF'
[dashboard] Add CandidateRepo + candidate indexes

Org-scoped candidate pool with dedup on (org_id, normalized_keyword).
Unique index enforces dedup; insertMany dedupes batch + stored rows.

Part of #49

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Scaffold `@shared/providers` + DataForSEO error taxonomy

**Files:**
- Create: `packages/shared/providers/package.json`
- Create: `packages/shared/providers/src/index.ts`
- Create: `packages/shared/providers/src/dataforseo/errors.ts`
- Test: `packages/shared/providers/tests/errors.test.ts`
- Modify: `.env.example` (document DataForSEO credentials)

**Interfaces:**
- Produces:
  - `type DataForSeoErrorCategory = 'auth' | 'rate_limit' | 'invalid_request' | 'provider' | 'timeout' | 'network'`
  - `class DataForSeoError extends Error` with `category: DataForSeoErrorCategory` and `retryable: boolean`
  - `categorizeHttpStatus(status: number): DataForSeoErrorCategory`
  - `categorizeApiStatus(code: number): DataForSeoErrorCategory` (DataForSEO body `status_code`)
  - `isRetryable(category: DataForSeoErrorCategory): boolean`

- [ ] **Step 1: Create the package manifest**

Create `packages/shared/providers/package.json`:

```json
{
  "name": "@shared/providers",
  "version": "0.0.0",
  "type": "module",
  "main": "src/index.ts",
  "sideEffects": false,
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@shared/schemas": "*"
  }
}
```

- [ ] **Step 2: Install so the workspace symlink is created**

Run: `npm install`
Expected: adds `@shared/providers` to the workspace; `node_modules/@shared/providers` symlink exists.

- [ ] **Step 3: Write the failing test**

Create `packages/shared/providers/tests/errors.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  categorizeApiStatus,
  categorizeHttpStatus,
  DataForSeoError,
  isRetryable,
} from '../src';

describe('categorizeHttpStatus', () => {
  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'invalid_request'],
    [404, 'invalid_request'],
    [500, 'provider'],
    [503, 'provider'],
  ])('%i -> %s', (status, expected) => {
    expect(categorizeHttpStatus(status as number)).toBe(expected);
  });
});

describe('categorizeApiStatus (DataForSEO body status_code)', () => {
  test.each([
    [40100, 'auth'],
    [40200, 'rate_limit'],
    [40000, 'invalid_request'],
    [50000, 'provider'],
  ])('%i -> %s', (code, expected) => {
    expect(categorizeApiStatus(code as number)).toBe(expected);
  });
});

describe('isRetryable', () => {
  test('retries transient categories only', () => {
    expect(isRetryable('rate_limit')).toBe(true);
    expect(isRetryable('provider')).toBe(true);
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('timeout')).toBe(true);
    expect(isRetryable('auth')).toBe(false);
    expect(isRetryable('invalid_request')).toBe(false);
  });
});

describe('DataForSeoError', () => {
  test('carries category + retryable and leaks no credentials', () => {
    const err = new DataForSeoError('auth', 'DataForSEO request failed (auth)');
    expect(err.category).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('DataForSeoError');
    expect(err.message).not.toMatch(/authorization|basic |password/i);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -- providers/tests/errors`
Expected: FAIL — cannot resolve `../src`.

- [ ] **Step 5: Write the error module**

Create `packages/shared/providers/src/dataforseo/errors.ts`:

```ts
/** Normalized, credential-free failure categories for DataForSEO calls. */
export type DataForSeoErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'provider'
  | 'timeout'
  | 'network';

const RETRYABLE: ReadonlySet<DataForSeoErrorCategory> = new Set([
  'rate_limit',
  'provider',
  'network',
  'timeout',
]);

export function isRetryable(category: DataForSeoErrorCategory): boolean {
  return RETRYABLE.has(category);
}

/** Map an HTTP response status to a category. */
export function categorizeHttpStatus(status: number): DataForSeoErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'invalid_request';
}

/**
 * Map a DataForSEO body `status_code` (returned even on HTTP 200) to a category.
 * 401xx = auth, 402xx = rate/quota limit, 5xxxx = provider, else invalid request.
 */
export function categorizeApiStatus(code: number): DataForSeoErrorCategory {
  if (code >= 40100 && code < 40200) return 'auth';
  if (code >= 40200 && code < 40300) return 'rate_limit';
  if (code >= 50000) return 'provider';
  return 'invalid_request';
}

/**
 * A DataForSEO failure. Messages/fields never include credentials or the
 * Authorization header.
 */
export class DataForSeoError extends Error {
  readonly category: DataForSeoErrorCategory;
  readonly retryable: boolean;

  constructor(category: DataForSeoErrorCategory, message: string) {
    super(message);
    this.name = 'DataForSeoError';
    this.category = category;
    this.retryable = isRetryable(category);
  }
}
```

- [ ] **Step 6: Create the package index**

Create `packages/shared/providers/src/index.ts`:

```ts
export * from './dataforseo/errors';
```

- [ ] **Step 7: Document credentials in `.env.example`**

Modify `.env.example` — append at the end:

```bash

# DataForSEO (read by the API + worker when keyword research is wired in).
# Local dev: set the plain login/password below. Deployed envs leave these
# unset and instead resolve SSM SecureStrings named by *_PARAM (see infra).
DATAFORSEO_LOGIN=
DATAFORSEO_PASSWORD=
# DATAFORSEO_LOGIN_PARAM=
# DATAFORSEO_PASSWORD_PARAM=
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test -- providers/tests/errors`
Expected: PASS.

- [ ] **Step 9: Lint + typecheck**

Run: `npm run lint:fix && npm run check`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add packages/shared/providers .env.example package-lock.json
git commit -m "$(cat <<'EOF'
[dashboard] Scaffold @shared/providers + DataForSEO error taxonomy

New shared package for server-side provider clients. Normalized,
credential-free error categories with HTTP/API status mapping.

Part of #49

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: DataForSEO client core + `keywordsForSite`

**Files:**
- Create: `packages/shared/providers/src/dataforseo/types.ts`
- Create: `packages/shared/providers/src/dataforseo/client.ts`
- Modify: `packages/shared/providers/src/index.ts` (export client + types)
- Test: `packages/shared/providers/tests/dataforseo.test.ts`

**Interfaces:**
- Consumes: `type SearchIntent` from `@shared/schemas`; `DataForSeoError`, `categorizeHttpStatus`, `categorizeApiStatus`, `isRetryable` from `./errors`.
- Produces:
  - `interface KeywordMetric { keyword: string; search_volume: number | null; difficulty: number | null; cpc: number | null; competition: number | null; trend: number | null; intent: SearchIntent | null }`
  - `interface DataForSeoConfig { login: string; password: string; baseUrl?: string; timeoutMs?: number; maxRetries?: number; retryDelayMs?: number }`
  - `interface SiteKeywordsParams { target: string; locationName?: string; languageName?: string; limit?: number }`
  - `type DataForSeoClient` (return of the factory) with `keywordsForSite(params: SiteKeywordsParams): Promise<KeywordMetric[]>`
  - `createDataForSeoClient(config: DataForSeoConfig): DataForSeoClient`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/providers/tests/dataforseo.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createDataForSeoClient, DataForSeoError } from '../src';

function labsResponse(items: unknown[]) {
  return new Response(
    JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const client = () =>
  createDataForSeoClient({ login: 'u', password: 'p', maxRetries: 2, retryDelayMs: 0 });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('keywordsForSite', () => {
  test('sends Basic auth + normalizes items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      labsResponse([
        {
          keyword: 'Best SEO Tools',
          keyword_info: {
            search_volume: 1000,
            cpc: 2.5,
            competition: 0.3,
            search_volume_trend: { yearly: -12 },
          },
          keyword_properties: { keyword_difficulty: 40 },
          search_intent_info: { main_intent: 'commercial' },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().keywordsForSite({ target: 'example.com' });

    expect(out).toEqual([
      {
        keyword: 'Best SEO Tools',
        search_volume: 1000,
        difficulty: 40,
        cpc: 2.5,
        competition: 0.3,
        trend: -12,
        intent: 'commercial',
      },
    ]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/dataforseo_labs/google/keywords_for_site/live');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('u:p').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual([{ target: 'example.com' }]);
  });

  test('nulls missing metrics and unknown intent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(labsResponse([{ keyword: 'seo audit' }])),
    );
    const [out] = await client().keywordsForSite({ target: 'example.com' });
    expect(out).toEqual({
      keyword: 'seo audit',
      search_volume: null,
      difficulty: null,
      cpc: null,
      competition: null,
      trend: null,
      intent: null,
    });
  });

  test('maps 401 to auth and does NOT retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      name: 'DataForSeoError',
      category: 'auth',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('retries on 500 up to maxRetries then throws provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      category: 'provider',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  test('retries 500 then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('boom', { status: 500 }))
      .mockResolvedValueOnce(labsResponse([{ keyword: 'ok' }]));
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().keywordsForSite({ target: 'x' });
    expect(out[0]!.keyword).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('a thrown fetch (network) is categorized and retried', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      category: 'network',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test('DataForSEO body error status_code maps without HTTP error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ status_code: 40100, status_message: 'auth' }), {
          status: 200,
        }),
      ),
    );
    await expect(client().keywordsForSite({ target: 'x' })).rejects.toMatchObject({
      category: 'auth',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- providers/tests/dataforseo`
Expected: FAIL — `createDataForSeoClient` not exported.

- [ ] **Step 3: Write the normalized types**

Create `packages/shared/providers/src/dataforseo/types.ts`:

```ts
import type { SearchIntent } from '@shared/schemas';

/** Normalized keyword metrics returned by the Labs endpoints. */
export interface KeywordMetric {
  keyword: string;
  search_volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number | null;
  intent: SearchIntent | null;
}

/** Normalized organic SERP result. */
export interface SerpResult {
  rank: number;
  url: string;
  domain: string;
  title: string;
}

export interface DataForSeoConfig {
  login: string;
  password: string;
  /** Defaults to https://api.dataforseo.com/v3 */
  baseUrl?: string;
  /** Per-request timeout. Default 15000ms. */
  timeoutMs?: number;
  /** Retries on transient errors. Default 2. */
  maxRetries?: number;
  /** Base backoff between retries (ms), doubled each attempt. Default 200. */
  retryDelayMs?: number;
}

export interface SiteKeywordsParams {
  target: string;
  locationName?: string;
  languageName?: string;
  limit?: number;
}
```

- [ ] **Step 4: Write the client**

Create `packages/shared/providers/src/dataforseo/client.ts`:

```ts
import type { SearchIntent } from '@shared/schemas';
import { SEARCH_INTENTS } from '@shared/schemas';
import {
  categorizeApiStatus,
  categorizeHttpStatus,
  DataForSeoError,
  isRetryable,
} from './errors';
import type {
  DataForSeoConfig,
  KeywordMetric,
  SiteKeywordsParams,
} from './types';

const DEFAULT_BASE_URL = 'https://api.dataforseo.com/v3';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toSearchIntent(raw: unknown): SearchIntent | null {
  return typeof raw === 'string' && (SEARCH_INTENTS as readonly string[]).includes(raw)
    ? (raw as SearchIntent)
    : null;
}

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** Normalize one Labs `items[]` entry into a KeywordMetric. */
function toKeywordMetric(item: Record<string, unknown>): KeywordMetric {
  const info = (item.keyword_info ?? {}) as Record<string, unknown>;
  const props = (item.keyword_properties ?? {}) as Record<string, unknown>;
  const intentInfo = (item.search_intent_info ?? {}) as Record<string, unknown>;
  const trend = (info.search_volume_trend ?? {}) as Record<string, unknown>;
  return {
    keyword: String(item.keyword ?? ''),
    search_volume: num(info.search_volume),
    // Difficulty lives in keyword_properties for most Labs endpoints; the bulk
    // endpoint returns it directly on the item.
    difficulty: num(props.keyword_difficulty ?? item.keyword_difficulty),
    cpc: num(info.cpc),
    competition: num(info.competition),
    trend: num(trend.yearly),
    intent: toSearchIntent(intentInfo.main_intent),
  };
}

export type DataForSeoClient = {
  keywordsForSite(params: SiteKeywordsParams): Promise<KeywordMetric[]>;
};

export function createDataForSeoClient(config: DataForSeoConfig): DataForSeoClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const authHeader = `Basic ${Buffer.from(`${config.login}:${config.password}`).toString('base64')}`;

  /** POST a single task and return its `result` array. Handles timeout/retry. */
  async function request(path: string, task: Record<string, unknown>): Promise<unknown[]> {
    let attempt = 0;
    // Loop: initial try + up to maxRetries retries on retryable categories.
    for (;;) {
      try {
        return await once(path, task);
      } catch (err) {
        const retryable = err instanceof DataForSeoError && isRetryable(err.category);
        if (!retryable || attempt >= maxRetries) throw err;
        await sleep(retryDelayMs * 2 ** attempt);
        attempt += 1;
      }
    }
  }

  async function once(path: string, task: Record<string, unknown>): Promise<unknown[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify([task]),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new DataForSeoError('timeout', 'DataForSEO request timed out (timeout)');
      }
      throw new DataForSeoError('network', 'DataForSEO request failed (network)');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const category = categorizeHttpStatus(res.status);
      throw new DataForSeoError(category, `DataForSEO request failed (${category})`);
    }

    const body = (await res.json()) as {
      status_code?: number;
      tasks?: Array<{ status_code?: number; result?: unknown[] }>;
    };

    if (typeof body.status_code === 'number' && body.status_code >= 30000) {
      const category = categorizeApiStatus(body.status_code);
      throw new DataForSeoError(category, `DataForSEO request failed (${category})`);
    }

    const taskResult = body.tasks?.[0];
    if (taskResult?.status_code && taskResult.status_code >= 30000) {
      const category = categorizeApiStatus(taskResult.status_code);
      throw new DataForSeoError(category, `DataForSEO request failed (${category})`);
    }

    return taskResult?.result ?? [];
  }

  /** Flatten the `result[].items[]` shape the Labs endpoints share. */
  function itemsOf(result: unknown[]): Record<string, unknown>[] {
    return result.flatMap((r) => {
      const items = (r as { items?: unknown[] }).items ?? [];
      return items as Record<string, unknown>[];
    });
  }

  return {
    async keywordsForSite(params: SiteKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { target: params.target };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      if (params.limit) task.limit = params.limit;
      const result = await request('/dataforseo_labs/google/keywords_for_site/live', task);
      return itemsOf(result).map(toKeywordMetric);
    },
  };
}
```

- [ ] **Step 5: Export from the package index**

Modify `packages/shared/providers/src/index.ts` to:

```ts
export * from './dataforseo/client';
export * from './dataforseo/errors';
export type * from './dataforseo/types';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- providers/tests/dataforseo`
Expected: PASS (7 tests).

- [ ] **Step 7: Lint + typecheck**

Run: `npm run lint:fix && npm run check`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/providers/src packages/shared/providers/tests/dataforseo.test.ts
git commit -m "$(cat <<'EOF'
[dashboard] Add DataForSEO client core + keywordsForSite

Basic-auth POST with AbortController timeout and bounded retry on
transient categories. Normalizes Labs items to KeywordMetric.

Part of #49

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Remaining DataForSEO endpoints

**Files:**
- Modify: `packages/shared/providers/src/dataforseo/types.ts` (add param types)
- Modify: `packages/shared/providers/src/dataforseo/client.ts` (add 4 methods)
- Test: `packages/shared/providers/tests/dataforseo.test.ts` (extend)

**Interfaces:**
- Produces on `DataForSeoClient`:
  - `rankedKeywords(params: SiteKeywordsParams): Promise<KeywordMetric[]>`
  - `keywordIdeas(params: SeedKeywordsParams): Promise<KeywordMetric[]>`
  - `bulkKeywordDifficulty(params: SeedKeywordsParams): Promise<KeywordMetric[]>`
  - `serpGoogleOrganic(params: SerpParams): Promise<SerpResult[]>`
  - `interface SeedKeywordsParams { keywords: string[]; locationName?: string; languageName?: string; limit?: number }`
  - `interface SerpParams { keyword: string; locationName?: string; languageName?: string; depth?: number }`

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/providers/tests/dataforseo.test.ts` (inside the file, new `describe` blocks). Add `SerpResult`-shaped helper and cases:

```ts
function serpResponse(items: unknown[]) {
  return new Response(
    JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result: [{ items }] }] }),
    { status: 200 },
  );
}

describe('rankedKeywords', () => {
  test('normalizes and hits the ranked_keywords endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      // ranked_keywords nests metrics under keyword_data.
      new Response(
        JSON.stringify({
          status_code: 20000,
          tasks: [
            {
              status_code: 20000,
              result: [
                {
                  items: [
                    { keyword: 'seo', keyword_info: { search_volume: 50 } },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().rankedKeywords({ target: 'x.com' });
    expect(out[0]).toMatchObject({ keyword: 'seo', search_volume: 50 });
    expect(fetchMock.mock.calls[0]![0]).toContain(
      '/dataforseo_labs/google/ranked_keywords/live',
    );
  });
});

describe('keywordIdeas', () => {
  test('sends keywords array to keyword_ideas endpoint', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(labsResponse([{ keyword: 'idea one' }]));
    vi.stubGlobal('fetch', fetchMock);
    const out = await client().keywordIdeas({ keywords: ['seed'] });
    expect(out[0]!.keyword).toBe('idea one');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/dataforseo_labs/google/keyword_ideas/live');
    expect(JSON.parse(init.body as string)).toEqual([{ keywords: ['seed'] }]);
  });
});

describe('bulkKeywordDifficulty', () => {
  test('reads difficulty off the item directly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        labsResponse([{ keyword: 'seo tools', keyword_difficulty: 42 }]),
      ),
    );
    const out = await client().bulkKeywordDifficulty({ keywords: ['seo tools'] });
    expect(out[0]).toMatchObject({ keyword: 'seo tools', difficulty: 42 });
  });
});

describe('serpGoogleOrganic', () => {
  test('normalizes organic results and skips non-organic items', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        serpResponse([
          { type: 'organic', rank_absolute: 1, url: 'https://a.com/x', domain: 'a.com', title: 'A' },
          { type: 'paid', rank_absolute: 2, url: 'https://ad.com', domain: 'ad.com', title: 'Ad' },
          { type: 'organic', rank_absolute: 3, url: 'https://b.com/y', domain: 'b.com', title: 'B' },
        ]),
      ),
    );
    const out = await client().serpGoogleOrganic({ keyword: 'seo tools' });
    expect(out).toEqual([
      { rank: 1, url: 'https://a.com/x', domain: 'a.com', title: 'A' },
      { rank: 3, url: 'https://b.com/y', domain: 'b.com', title: 'B' },
    ]);
  });

  test('posts to the SERP live advanced endpoint with the keyword', async () => {
    const fetchMock = vi.fn().mockResolvedValue(serpResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    await client().serpGoogleOrganic({ keyword: 'seo tools' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/serp/google/organic/live/advanced');
    expect(JSON.parse(init.body as string)).toEqual([{ keyword: 'seo tools' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- providers/tests/dataforseo`
Expected: FAIL — `rankedKeywords` / `keywordIdeas` / `bulkKeywordDifficulty` / `serpGoogleOrganic` are not functions.

- [ ] **Step 3: Add the param types**

Modify `packages/shared/providers/src/dataforseo/types.ts` — append:

```ts
export interface SeedKeywordsParams {
  keywords: string[];
  locationName?: string;
  languageName?: string;
  limit?: number;
}

export interface SerpParams {
  keyword: string;
  locationName?: string;
  languageName?: string;
  depth?: number;
}
```

- [ ] **Step 4: Add the four methods**

Modify `packages/shared/providers/src/dataforseo/client.ts`:

First, extend the imports from `./types`:

```ts
import type {
  DataForSeoConfig,
  KeywordMetric,
  SeedKeywordsParams,
  SerpParams,
  SerpResult,
  SiteKeywordsParams,
} from './types';
```

Extend the `DataForSeoClient` type:

```ts
export type DataForSeoClient = {
  keywordsForSite(params: SiteKeywordsParams): Promise<KeywordMetric[]>;
  rankedKeywords(params: SiteKeywordsParams): Promise<KeywordMetric[]>;
  keywordIdeas(params: SeedKeywordsParams): Promise<KeywordMetric[]>;
  bulkKeywordDifficulty(params: SeedKeywordsParams): Promise<KeywordMetric[]>;
  serpGoogleOrganic(params: SerpParams): Promise<SerpResult[]>;
};
```

Add a SERP normalizer near `toKeywordMetric` (module scope):

```ts
/** Normalize one SERP `items[]` organic entry. */
function toSerpResult(item: Record<string, unknown>): SerpResult {
  return {
    rank: num(item.rank_absolute) ?? 0,
    url: String(item.url ?? ''),
    domain: String(item.domain ?? ''),
    title: String(item.title ?? ''),
  };
}
```

Then, inside the object returned by `createDataForSeoClient`, add after `keywordsForSite`:

```ts
    async rankedKeywords(params: SiteKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { target: params.target };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      if (params.limit) task.limit = params.limit;
      const result = await request('/dataforseo_labs/google/ranked_keywords/live', task);
      return itemsOf(result).map(toKeywordMetric);
    },

    async keywordIdeas(params: SeedKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { keywords: params.keywords };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      if (params.limit) task.limit = params.limit;
      const result = await request('/dataforseo_labs/google/keyword_ideas/live', task);
      return itemsOf(result).map(toKeywordMetric);
    },

    async bulkKeywordDifficulty(params: SeedKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { keywords: params.keywords };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      const result = await request(
        '/dataforseo_labs/google/bulk_keyword_difficulty/live',
        task,
      );
      return itemsOf(result).map(toKeywordMetric);
    },

    async serpGoogleOrganic(params: SerpParams): Promise<SerpResult[]> {
      const task: Record<string, unknown> = { keyword: params.keyword };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      if (params.depth) task.depth = params.depth;
      const result = await request('/serp/google/organic/live/advanced', task);
      return itemsOf(result)
        .filter((item) => item.type === 'organic')
        .map(toSerpResult);
    },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- providers/tests/dataforseo`
Expected: PASS (all cases).

- [ ] **Step 6: Full verification**

Run: `npm run lint:fix && npm run check && npm test`
Expected: lint clean, typecheck clean, all unit tests pass.

Run: `npm run test:integration -- candidate`
Expected: CandidateRepo integration tests pass (Mongo up).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/providers/src packages/shared/providers/tests/dataforseo.test.ts
git commit -m "$(cat <<'EOF'
[dashboard] Add remaining DataForSEO endpoints

rankedKeywords, keywordIdeas, bulkKeywordDifficulty, and
serpGoogleOrganic — completing the 5 endpoints #49 requires.

Part of #49

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation

- [ ] Update `PROGRESS.md`: mark the DataForSEO client + candidate pool foundation as built, linking `[#49]`. Keep it to one terse line per the repo's source-of-truth rule.
- [ ] Open a PR into `dev` with body describing the change and `Part of #56`, `Closes #49`. Run `npm run lint`, `npm run check:all`, `npm test` first (CI runs the same).

## Self-review notes

- **Spec coverage:** client (Tasks 3–5) ✓; 5 endpoints (Tasks 4–5) ✓; candidate schema with provenance/metrics/scores/status (Task 1) ✓; repo create/query/update/dedupe (Task 2) ✓; indexes in `ensureIndexes()` (Task 2) ✓; normalized non-secret errors (Task 3) ✓; separation from `keywords` (own collection, Task 2) ✓; injected credentials / no consumer wiring ✓; env docs (Task 3) ✓. Deferred `article_type`/`rejection_reason` and scoring stay out — matches spec.
- **Type consistency:** `KeywordMetric`, `DataForSeoConfig`, `SiteKeywordsParams`/`SeedKeywordsParams`/`SerpParams`, `DataForSeoError`, `categorizeHttpStatus`/`categorizeApiStatus`/`isRetryable`, `CandidateRepo` method names, and `normalizeKeyword` are used consistently across tasks.
