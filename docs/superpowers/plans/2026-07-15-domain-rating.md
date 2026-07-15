# Domain Rating Implementation Plan (PR 1 of issue #12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard's hardcoded `Domain Rating —` badge with a real 0–100 value sourced from DataForSEO, fetched at scan time and stale-refreshed on dashboard read.

**Architecture:** New `backlinksSummary` provider method (DataForSEO `/backlinks/summary/live`, raw `rank` 0–1000) + a `domainRatingFromRank` normalizer (0–100). The scanner worker stamps `org.domain_rating` after a scan (best-effort). A new `GET /dashboard/domain-rating` endpoint returns the stored value, re-fetching inline when older than 7 days. The web dashboard header renders it.

**Tech Stack:** TypeScript monorepo (npm workspaces), `@hono/zod-openapi` routes with typed RPC client, Zod schemas, official mongodb driver, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-15-domain-rating-gsc-design.md` (Part 1).

## Global Constraints

- Branch: `ozykhan/domain-rating` (already exists, carries the spec commit). PR into `dev`, body includes `Part of #12`. Never commit to `dev` directly.
- Biome formatting: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new code.
- `verbatimModuleSyntax`: use `import type` for type-only imports.
- Every `.openapi(...)` route stays **chained** on the router expression so `AppType` captures it.
- Before claiming done: `npm run lint`, `npm run check:all`, `npm test` must all pass.
- Unit tests need no infra; `npm run test:integration` needs `docker compose up -d mongo`.
- All test/lint/check commands run from the repo root.

---

### Task 1: DataForSEO `backlinksSummary` + `domainRatingFromRank`

**Files:**
- Modify: `packages/shared/providers/src/dataforseo/types.ts`
- Modify: `packages/shared/providers/src/dataforseo/client.ts`
- Test: `packages/shared/providers/tests/dataforseo.test.ts`

**Interfaces:**
- Consumes: existing `request(path, task)` helper inside `createDataForSeoClient`, existing `num()` coercion helper.
- Produces: `DataForSeoClient.backlinksSummary(target: string): Promise<BacklinksSummary>` where `BacklinksSummary = { rank: number | null }` (raw DataForSEO 0–1000 scale), and standalone export `domainRatingFromRank(rank: number | null): number | null` (0–100, clamped). Both exported from `@shared/providers` (via the existing `export * from './dataforseo/client'` / `export type * from './dataforseo/types'` in `packages/shared/providers/src/index.ts` — no index change needed).

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/providers/tests/dataforseo.test.ts` (it already has `client()`, `vi.stubGlobal`, and an `afterEach` that restores mocks):

```ts
describe('backlinksSummary', () => {
  // The backlinks summary endpoint returns fields directly on result[0] — no items[] nesting.
  function summaryResponse(result: unknown[]) {
    return new Response(
      JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, result }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  test('extracts rank from result[0]', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(summaryResponse([{ target: 'example.com', rank: 423, backlinks: 12 }]));
    vi.stubGlobal('fetch', fetchMock);

    const out = await client().backlinksSummary('example.com');

    expect(out).toEqual({ rank: 423 });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toContain('/backlinks/summary/live');
    expect(JSON.parse(init.body as string)).toEqual([{ target: 'example.com' }]);
  });

  test('nulls a missing rank', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse([{ target: 'x' }])));
    expect(await client().backlinksSummary('x')).toEqual({ rank: null });
  });

  test('nulls rank on an empty result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(summaryResponse([])));
    expect(await client().backlinksSummary('x')).toEqual({ rank: null });
  });
});

describe('domainRatingFromRank', () => {
  test('normalizes 0–1000 rank to a 0–100 rating', () => {
    expect(domainRatingFromRank(423)).toBe(42);
    expect(domainRatingFromRank(0)).toBe(0);
    expect(domainRatingFromRank(1000)).toBe(100);
  });

  test('clamps out-of-range values', () => {
    expect(domainRatingFromRank(1200)).toBe(100);
    expect(domainRatingFromRank(-5)).toBe(0);
  });

  test('passes null through', () => {
    expect(domainRatingFromRank(null)).toBeNull();
  });
});
```

Also update the import at the top of the file:

```ts
import { createDataForSeoClient, domainRatingFromRank } from '../src';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dataforseo`
Expected: FAIL — `domainRatingFromRank` is not exported / `backlinksSummary` is not a function.

- [ ] **Step 3: Implement**

In `packages/shared/providers/src/dataforseo/types.ts`, append:

```ts
/** Normalized backlinks summary — currently only the domain rank (0–1000). */
export interface BacklinksSummary {
  rank: number | null;
}
```

In `packages/shared/providers/src/dataforseo/client.ts`:

1. Add `BacklinksSummary` to the type-only import from `./types`.
2. Add a standalone export after `toSerpResult` (module level, before `DataForSeoClient`):

```ts
/**
 * DataForSEO's backlink rank is 0–1000; the dashboard badge shows a 0–100
 * DR-style score (#12). Clamped so provider drift can't break the schema.
 */
export function domainRatingFromRank(rank: number | null): number | null {
  if (rank === null) return null;
  return Math.max(0, Math.min(100, Math.round(rank / 10)));
}
```

3. Add to the `DataForSeoClient` type:

```ts
  backlinksSummary(target: string): Promise<BacklinksSummary>;
```

4. Add to the returned object in `createDataForSeoClient` (after `serpGoogleOrganic`). Note the summary endpoint puts fields directly on `result[0]` — do NOT use `itemsOf`:

```ts
    async backlinksSummary(target: string): Promise<BacklinksSummary> {
      const result = await request('/backlinks/summary/live', { target });
      const first = (result[0] ?? {}) as Record<string, unknown>;
      return { rank: num(first.rank) };
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dataforseo`
Expected: PASS (all pre-existing tests too — retry/auth behavior comes from the shared `request` helper).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/providers/src/dataforseo/types.ts packages/shared/providers/src/dataforseo/client.ts packages/shared/providers/tests/dataforseo.test.ts
git commit -m "[backend] DataForSEO backlinksSummary + domainRatingFromRank (#12)"
```

---

### Task 2: `OrgSchema.domain_rating` + `OrgRepo.updateDomainRating`

**Files:**
- Modify: `packages/shared/schemas/src/org.ts`
- Modify: `packages/shared/db/src/repositories/org.repo.ts`
- Test: `packages/shared/schemas/tests/org.test.ts`
- Test: `packages/shared/db/tests/org.repo.integration.test.ts`

**Interfaces:**
- Produces: optional `Org.domain_rating?: { value: number; checked_at: Date }` and `OrgRepo.updateDomainRating(id: string, value: number): Promise<void>` (stamps `checked_at: new Date()` itself).

- [ ] **Step 1: Write the failing schema test**

Append to `packages/shared/schemas/tests/org.test.ts`:

```ts
describe('OrgSchema domain rating', () => {
  test('is optional (back-compat with stored orgs)', () => {
    expect(OrgSchema.parse(base).domain_rating).toBeUndefined();
  });

  test('parses a stored value with its check timestamp', () => {
    const org = OrgSchema.parse({
      ...base,
      domain_rating: { value: 42, checked_at: new Date('2026-07-15T00:00:00Z') },
    });
    expect(org.domain_rating?.value).toBe(42);
  });

  test('rejects out-of-range values', () => {
    expect(() =>
      OrgSchema.parse({ ...base, domain_rating: { value: 101, checked_at: new Date() } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- org.test`
Expected: FAIL — `domain_rating` is stripped/unknown (parse of the valid shape returns undefined field or the invalid shape doesn't throw).

- [ ] **Step 3: Add the schema field**

In `packages/shared/schemas/src/org.ts`, inside `OrgSchema` after `presets`:

```ts
  // Latest 0–100 Domain Rating for the dashboard badge (#12); refreshed by the
  // scanner worker and the stale-refresh path in GET /dashboard/domain-rating.
  domain_rating: z
    .object({ value: z.number().int().min(0).max(100), checked_at: z.date() })
    .optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- org.test`
Expected: PASS.

- [ ] **Step 5: Add the repo method**

In `packages/shared/db/src/repositories/org.repo.ts`, add to `OrgRepo` (after `setPlan`):

```ts
  /** Store the latest Domain Rating (0–100) with its fetch timestamp (#12). */
  async updateDomainRating(id: string, value: number): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { domain_rating: { value, checked_at: new Date() } } },
    );
  },
```

- [ ] **Step 6: Write the integration test**

Append to `packages/shared/db/tests/org.repo.integration.test.ts` (inside the existing describe block, matching its style — it already creates orgs via `OrgRepo.create`):

```ts
  test('updateDomainRating stores value + checked_at, readable via findById', async () => {
    const org = await OrgRepo.create({
      user_id: 'user_dr',
      website_url: 'https://dr.example.com',
      setup_status: 'setup_scan_in_progress',
    });

    await OrgRepo.updateDomainRating(org.id, 42);

    const found = await OrgRepo.findById(org.id);
    expect(found?.domain_rating?.value).toBe(42);
    expect(found?.domain_rating?.checked_at).toBeInstanceOf(Date);
  });
```

- [ ] **Step 7: Run the integration test**

Run: `docker compose up -d mongo && npm run test:integration -- org.repo`
Expected: PASS. (If Docker is unavailable, note it in the task report and rely on `npm test` + typecheck.)

- [ ] **Step 8: Commit**

```bash
git add packages/shared/schemas/src/org.ts packages/shared/schemas/tests/org.test.ts packages/shared/db/src/repositories/org.repo.ts packages/shared/db/tests/org.repo.integration.test.ts
git commit -m "[backend] Org.domain_rating field + OrgRepo.updateDomainRating (#12)"
```

---

### Task 3: Scan-time Domain Rating fetch in the worker

**Files:**
- Modify: `apps/worker/src/providers.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/tests/worker.test.ts`

**Interfaces:**
- Consumes: `backlinksSummary` + `domainRatingFromRank` from Task 1, `OrgRepo.updateDomainRating` from Task 2.
- Produces: `getScanClients()` now returns `{ llm, dataForSeo }`. (`scanWebsite`'s `ScanClients` param only requires `llm` — structural typing accepts the extra key; do not change `scanner.ts`.)

- [ ] **Step 1: Write the failing tests**

In `apps/worker/tests/worker.test.ts`:

1. Extend the `@shared/db` mock with a spy:

```ts
const { completeScan, updateDomainRating } = vi.hoisted(() => ({
  completeScan: vi.fn(async (_id: string, _presets: { business: { name: string } }) => {}),
  updateDomainRating: vi.fn(async (_id: string, _value: number) => {}),
}));

vi.mock('@shared/db', () => ({
  OrgRepo: { completeScan, updateDomainRating },
}));
```

2. Mock the providers module so no real clients are built (add after the scanner mock):

```ts
const { backlinksSummary } = vi.hoisted(() => ({
  backlinksSummary: vi.fn(async (_target: string) => ({ rank: 423 })),
}));
vi.mock('../src/providers', () => ({
  getScanClients: () => ({ llm: {}, dataForSeo: { backlinksSummary } }),
}));
```

3. Add tests to the `scanner worker` describe block:

```ts
  test('stamps the domain rating after a successful scan', async () => {
    await handler(
      sqsEvent({ org_id: '6650f1a2b3c4d5e6f7a8b9c0', website_url: 'https://www.clewas.com' }),
      {} as never,
      () => {},
    );

    expect(backlinksSummary).toHaveBeenCalledWith('clewas.com');
    expect(updateDomainRating).toHaveBeenCalledWith('6650f1a2b3c4d5e6f7a8b9c0', 42);
  });

  test('a domain-rating failure never fails the scan', async () => {
    backlinksSummary.mockRejectedValueOnce(new Error('provider down'));

    await expect(
      handler(
        sqsEvent({ org_id: '6650f1a2b3c4d5e6f7a8b9c0', website_url: 'https://clewas.com' }),
        {} as never,
        () => {},
      ),
    ).resolves.toBeUndefined();

    expect(completeScan).toHaveBeenCalled();
    expect(updateDomainRating).not.toHaveBeenCalledWith('6650f1a2b3c4d5e6f7a8b9c0', expect.anything());
  });
```

4. Add `beforeEach(() => { vi.clearAllMocks(); })` inside the describe block so call counts don't leak between tests (the existing first test still passes — it only asserts on its own call).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- worker`
Expected: FAIL — `backlinksSummary` never called / `updateDomainRating` never called.

- [ ] **Step 3: Implement**

In `apps/worker/src/providers.ts`, replace `getScanClients`:

```ts
/** Build the LLM + DataForSEO clients the scanner worker needs, from env. */
export function getScanClients() {
  return {
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
    dataForSeo: createDataForSeoClient({
      login: process.env.DATAFORSEO_LOGIN ?? '',
      password: process.env.DATAFORSEO_PASSWORD ?? '',
    }),
  };
}
```

In `apps/worker/src/index.ts`:

1. Add import: `import { domainRatingFromRank } from '@shared/providers';`
2. Replace the scan body inside the `try`:

```ts
      const clients = getScanClients();
      const presets = await scanWebsite(website_url, clients);
      await OrgRepo.completeScan(org_id, presets);

      // Domain Rating is best-effort (#12): a provider failure must never fail
      // the scan — the stale-refresh path on GET /dashboard/domain-rating
      // recovers later.
      try {
        const domain = new URL(website_url).hostname.replace(/^www\./, '');
        const { rank } = await clients.dataForSeo.backlinksSummary(domain);
        const rating = domainRatingFromRank(rank);
        if (rating !== null) await OrgRepo.updateDomainRating(org_id, rating);
        logger.info('domain rating stamped', { rating });
      } catch (drErr) {
        logger.warn('domain rating fetch failed', { error: drErr as Error });
      }

      logger.info('scan completed');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- worker`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/providers.ts apps/worker/src/index.ts apps/worker/tests/worker.test.ts
git commit -m "[backend] Scanner worker stamps Domain Rating after scan (#12)"
```

---

### Task 4: `GET /dashboard/domain-rating` endpoint

**Files:**
- Modify: `apps/api/src/schemas/dashboard.ts`
- Modify: `apps/api/src/routes/dashboard.ts`
- Test: `apps/api/tests/dashboard.test.ts`

**Interfaces:**
- Consumes: `loadOwnedOrg` (`apps/api/src/lib/load-owned-org.ts`), `getDataForSeoClient` (`apps/api/src/clients/providers.ts`), `domainRatingFromRank` from Task 1, `OrgRepo.updateDomainRating` from Task 2, `Org.domain_rating`.
- Produces: `GET /api/v0/dashboard/domain-rating?org_id=` → `{ rating: number | null }` (typed client path: `api.api.v0.dashboard['domain-rating'].$get({ query: { org_id } })`).

- [ ] **Step 1: Write the failing tests**

In `apps/api/tests/dashboard.test.ts`:

1. Add a providers mock near the google mock at the top (module scope, before imports of the app):

```ts
const { backlinksSummary } = vi.hoisted(() => ({
  backlinksSummary: vi.fn(async (_target: string) => ({ rank: 730 })),
}));
vi.mock('../src/clients/providers', () => ({
  getDataForSeoClient: () => ({ backlinksSummary }),
}));
```

2. Inside the `@shared/db` mock factory: give `org_1` a fresh rating by adding to its object (after `presets`):

```ts
        domain_rating: { value: 41, checked_at: new Date() },
```

add a fourth org with a stale rating to the `orgs` map:

```ts
    [
      'org_stale',
      {
        id: 'org_stale',
        user_id: 'user_1',
        website_url: 'https://www.stale.com',
        setup_status: 'setup_complete',
        domain_rating: { value: 12, checked_at: new Date('2026-01-01T00:00:00Z') },
        created_at: now,
      },
    ],
```

and extend the mocked `OrgRepo` with:

```ts
      updateDomainRating: vi.fn(async (id: string, value: number) => {
        const o = orgs.get(id);
        if (o) o.domain_rating = { value, checked_at: new Date() };
      }),
    },
```

3. Add a describe block:

```ts
describe('GET /dashboard/domain-rating', () => {
  async function auth() {
    const token = await login();
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  beforeEach(() => {
    backlinksSummary.mockClear();
    backlinksSummary.mockResolvedValue({ rank: 730 });
  });

  test('rejects requests without a token', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get({
      query: { org_id: 'org_1' },
    });
    expect(res.status).toBe(401);
  });

  test('returns the stored value without a provider call when fresh', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_1' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).rating).toBe(41);
    expect(backlinksSummary).not.toHaveBeenCalled();
  });

  test('re-fetches and persists when stale', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_stale' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).rating).toBe(73);
    expect(backlinksSummary).toHaveBeenCalledWith('stale.com');
  });

  test('falls back to the stale value when the provider fails', async () => {
    backlinksSummary.mockRejectedValueOnce(new Error('down'));
    // org_stale was refreshed by the previous test's mock store write; use a
    // fresh failure path org: org_2 has no rating at all.
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_2' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).rating).toBeNull();
  });

  test('fetches for an org that has no rating yet', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_2' } },
      await auth(),
    );
    expect(res.status).toBe(200);
    if (res.status === 200) expect((await res.json()).rating).toBe(73);
  });

  test('404s for an org the caller does not own', async () => {
    const res = await client.api.v0.dashboard['domain-rating'].$get(
      { query: { org_id: 'org_3' } },
      await auth(),
    );
    expect(res.status).toBe(404);
  });
});
```

Note: the mocked orgs live in a module-scoped Map, so writes persist across tests within the file. The "falls back" test runs before the "fetches" test would matter for `org_2` — Vitest runs tests in declaration order; the failing call happens first and leaves `org_2` unrated, then the success test rates it. Keep this order.

Add `beforeEach` to the existing vitest import if not present: `import { beforeEach, describe, expect, test, vi } from 'vitest';`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dashboard`
Expected: FAIL — the typed client has no `domain-rating` path (typecheck error) / 404 route not found.

- [ ] **Step 3: Implement schema + route**

In `apps/api/src/schemas/dashboard.ts`, after `ConnectedIntegrationsResponse`:

```ts
export const DomainRatingResponse = z
  .object({
    // 0–100 badge value; null when the org was never rated and the provider is
    // unavailable.
    rating: z.number().int().min(0).max(100).nullable(),
  })
  .openapi('DomainRatingResponse');
```

In `apps/api/src/routes/dashboard.ts`:

1. Add imports:

```ts
import { domainRatingFromRank } from '@shared/providers';
import { getDataForSeoClient } from '../clients/providers';
```

2. Add a module-level constant after the `toArticleDetail` helper:

```ts
/** Domain ratings refresh at most weekly — older values re-fetch inline on read (#12). */
const DOMAIN_RATING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
```

3. Chain a new route after the `/integrations/connected` route (before the Content Planner section), keeping the chain unbroken:

```ts
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/domain-rating',
      summary: 'Latest Domain Rating for the org (re-fetched when older than 7 days)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.OrgQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.DomainRatingResponse } },
          description: 'Domain rating; null when never rated and the provider is unavailable',
        },
        404: {
          content: { 'application/json': { schema: schemas.OrgNotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.json({ error: 'Not found' }, 404);

      const current = org.domain_rating ?? null;
      if (current && Date.now() - current.checked_at.getTime() < DOMAIN_RATING_MAX_AGE_MS) {
        return c.json({ rating: current.value }, 200);
      }

      // Stale or missing: re-fetch inline, falling back to the stored value
      // (or null) when the provider is down — the badge degrades, never errors.
      try {
        const domain = new URL(org.website_url).hostname.replace(/^www\./, '');
        const { rank } = await getDataForSeoClient().backlinksSummary(domain);
        const rating = domainRatingFromRank(rank);
        if (rating === null) return c.json({ rating: current?.value ?? null }, 200);
        await OrgRepo.updateDomainRating(org_id, rating);
        return c.json({ rating }, 200);
      } catch {
        return c.json({ rating: current?.value ?? null }, 200);
      }
    },
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dashboard`
Expected: PASS (all pre-existing dashboard tests too).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/schemas/dashboard.ts apps/api/src/routes/dashboard.ts apps/api/tests/dashboard.test.ts
git commit -m "[backend] GET /dashboard/domain-rating with weekly stale refresh (#12)"
```

---

### Task 5: Dashboard badge renders the real rating

**Files:**
- Modify: `apps/web/app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `api.api.v0.dashboard['domain-rating'].$get({ query: { org_id } })` from Task 4.

The web app has no unit tests; verification is the typecheck (the typed client makes a wrong path/shape a compile error).

- [ ] **Step 1: Implement**

In `apps/web/app/dashboard/page.tsx`:

1. Extend `HomeData`:

```ts
type HomeData = {
  published: number;
  planned: number;
  bestGated: boolean;
  integrations: number;
  domainRating: number | null;
};
```

2. Add the fetch to the existing `Promise.all` (after the `integrations` entry):

```ts
        activeOrg
          ? api.api.v0.dashboard['domain-rating'].$get({ query: { org_id: activeOrg.id } })
          : null,
```

destructure it as `domainRatingRes` in the array pattern:

```ts
      const [publishedRes, plannedRes, bestRes, integrationsRes, domainRatingRes] =
        await Promise.all([
```

3. Add to `setData`:

```ts
        domainRating: domainRatingRes?.ok ? (await domainRatingRes.json()).rating : null,
```

4. Replace the badge line:

```tsx
          <span style={badge}>Domain Rating {data?.domainRating ?? '—'}</span>
```

- [ ] **Step 2: Verify with the typechecker**

Run: `npm run check:all`
Expected: clean exit (both backend and web halves).

- [ ] **Step 3: Verify in the running app (if local infra is available)**

Run: `docker compose up -d && npm run dev`, log in at http://localhost:3000, open the dashboard. With `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` set in `.env` the badge shows a number after scan/refresh; without credentials it shows `—` (provider failure falls back to null). Either render proves the wiring.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/dashboard/page.tsx
git commit -m "[frontend] Dashboard header shows the real Domain Rating (#12)"
```

---

### Task 6: Infra env for the worker, docs, checks, PR

**Files:**
- Modify: `infra/lib/api-stack.ts:169-173` (the scanner `workerFn` environment)
- Modify: `PROGRESS.md:42`

**Interfaces:**
- Consumes: nothing new — the `providerEnv` const already exists in `api-stack.ts:132`.

- [ ] **Step 1: Give the scanner worker Lambda the DataForSEO credentials**

In `infra/lib/api-stack.ts`, the scanner `workerFn` (entry `apps/worker/src/index.ts`) currently gets only `mongoEnv` + `OPENROUTER_API_KEY`. Add `...providerEnv`:

```ts
      environment: {
        ...mongoEnv,
        ...providerEnv,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
      },
```

(No grant changes — DataForSEO creds follow the existing synth-time env pattern.)

- [ ] **Step 2: Verify infra still synthesizes**

Run: `cd infra && npm install && npx cdk synth --context stage=staging --quiet && cd ..`
Expected: clean synth. (If AWS context lookups block synth locally, note it and rely on typecheck: `cd infra && npx tsc --noEmit`.)

- [ ] **Step 3: Update PROGRESS.md**

Replace line 42:

```markdown
- 🟡 Domain Rating live (DataForSEO badge); Google Search Console remains — [#12](https://github.com/seopotion/seo/issues/12)
```

- [ ] **Step 4: Run the full check suite**

Run: `npm run lint && npm run check:all && npm test`
Expected: all pass. Fix anything that fails before proceeding (`npm run lint:fix` for formatting).

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add infra/lib/api-stack.ts PROGRESS.md
git commit -m "[infra] DataForSEO env for scanner worker; PROGRESS: DR live (#12)"
git push -u origin ozykhan/domain-rating
gh pr create --base dev --title "[backend] Domain Rating badge via DataForSEO (#12)" --body "$(cat <<'EOF'
## Summary
Part 1 of #12 — Domain Rating source + storage + dashboard badge (spec: docs/superpowers/specs/2026-07-15-domain-rating-gsc-design.md).

- `backlinksSummary` on the DataForSEO client + `domainRatingFromRank` (rank 0–1000 → DR-style 0–100)
- `Org.domain_rating { value, checked_at }`; scanner worker stamps it after a scan (best-effort, never fails the scan)
- `GET /dashboard/domain-rating` — stored value, inline re-fetch when older than 7 days, stale/null fallback on provider failure
- Dashboard header badge renders the real value
- Scanner worker Lambda now receives DataForSEO credentials

GSC (Part 2 of #12) follows in a separate PR.

Part of #12

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `dev`; CI runs the same lint/check/test suite and must pass.
