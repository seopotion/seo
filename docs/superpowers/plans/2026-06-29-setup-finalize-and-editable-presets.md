# Setup Finalize + Editable Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `PATCH /setup/presets` and `POST /setup/finalize` so a user can edit generated onboarding presets and advance the org to `setup_complete`, closing the onboarding loop.

**Architecture:** Two new auth-protected routes chained onto the existing `OpenAPIHono<AuthEnv>` router in `apps/api/src/routes/setup.ts`. A pure `mergePresets` helper does deep-partial merging; a `loadOwnedOrg` helper enforces per-user ownership (also backfilled into `GET /setup/details`). Two thin `OrgRepo` methods persist the results.

**Tech Stack:** Hono + `@hono/zod-openapi`, Zod 4, official `mongodb` driver, Vitest 4.

## Global Constraints

- `OpenAPIHono` + `createRoute` chained with `.openapi(...)` — never plain `Hono`. (Preserves `AppType`.)
- Zod API schemas use `.openapi('Name')`; export both the schema and its `z.infer` type where a type is needed.
- `import type` / `export type` for type-only imports (`verbatimModuleSyntax`).
- Repositories validate through Zod on write and own `_id` ↔ string `id` mapping; app code calls `OrgRepo`, never the driver.
- Auth: protected routes declare `security: [{ Bearer: [] }]` + `middleware: [authMiddleware] as const`; the user id is `c.get('auth').userId`.
- Tests mock `@shared/db` with `vi.mock` (hoisted above imports); drive HTTP via `testClient<AppType>(app)`.
- Always-green gates before done: `npm run lint`, `npm run check:all`, `npm test`.

---

## File Structure

- Create `apps/api/src/lib/merge-presets.ts` — pure `mergePresets(existing, partial)`.
- Create `apps/api/src/lib/load-owned-org.ts` — `loadOwnedOrg(org_id, userId)`.
- Modify `apps/api/src/schemas/setup.ts` — add patch/body/response schemas.
- Modify `packages/shared/db/src/repositories/org.repo.ts` — add `updatePresets`, `finalize`.
- Modify `apps/api/src/routes/setup.ts` — add PATCH + finalize routes; backfill ownership into `/details`.
- Create `apps/api/tests/merge-presets.test.ts` — unit tests for the merge helper.
- Modify `apps/api/tests/setup.test.ts` — add `user_id` to fixtures; add route + ownership tests.

---

## Task 1: `mergePresets` deep-partial merge helper

**Files:**
- Create: `apps/api/src/lib/merge-presets.ts`
- Test: `apps/api/tests/merge-presets.test.ts`

**Interfaces:**
- Consumes: `SetupPresets` type from `@shared/schemas`.
- Produces: `mergePresets(existing: SetupPresets, partial: DeepPartial<SetupPresets> | undefined): SetupPresets`. Pure. Recurses into plain objects; replaces arrays wholesale; `undefined` partial returns `existing` unchanged. The return value is **not** Zod-parsed here — callers parse via the repo's `SetupPresetsSchema.parse` on write.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/merge-presets.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { mergePresets } from '../src/lib/merge-presets';

const base = {
  business: { name: 'Old Co', language: 'English', country: 'US', description: 'Old.' },
  audience: { target: 'Devs', competitors: ['a.com', 'b.com'] },
  blog: {
    sitemap_url: 'https://x.com/sitemap.xml',
    main_blog_url: 'https://x.com/blog',
    best_articles: ['https://x.com/1'],
  },
  article_preferences: {
    content_seo: { article_style: 'Formal', internal_links: false, llm_instructions: 'old' },
    engagement: { image_style: 'Minimal' },
  },
};

describe('mergePresets', () => {
  test('merges a nested object field while preserving siblings', () => {
    const result = mergePresets(base, { business: { name: 'New Co' } });
    expect(result.business.name).toBe('New Co');
    expect(result.business.language).toBe('English');
    expect(result.business.country).toBe('US');
  });

  test('leaves untouched categories unchanged', () => {
    const result = mergePresets(base, { business: { name: 'New Co' } });
    expect(result.audience).toEqual(base.audience);
    expect(result.blog).toEqual(base.blog);
  });

  test('replaces array fields wholesale rather than concatenating', () => {
    const result = mergePresets(base, { audience: { competitors: ['c.com'] } });
    expect(result.audience.competitors).toEqual(['c.com']);
    expect(result.audience.target).toBe('Devs');
  });

  test('merges the two-level nest under article_preferences', () => {
    const result = mergePresets(base, {
      article_preferences: { content_seo: { internal_links: true } },
    });
    expect(result.article_preferences.content_seo.internal_links).toBe(true);
    expect(result.article_preferences.content_seo.article_style).toBe('Formal');
    expect(result.article_preferences.engagement.image_style).toBe('Minimal');
  });

  test('undefined partial returns existing unchanged', () => {
    expect(mergePresets(base, undefined)).toEqual(base);
  });

  test('does not mutate the existing object', () => {
    const snapshot = structuredClone(base);
    mergePresets(base, { business: { name: 'New Co' } });
    expect(base).toEqual(snapshot);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- merge-presets`
Expected: FAIL — `Cannot find module '../src/lib/merge-presets'`.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/lib/merge-presets.ts`:

```typescript
import type { SetupPresets } from '@shared/schemas';

/** Recursive partial: every nested object property is optional, arrays/scalars stay whole. */
export type DeepPartial<T> = T extends Array<unknown>
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(target: T, patch: DeepPartial<T>): T {
  if (!isPlainObject(target) || !isPlainObject(patch)) {
    // Scalars and arrays: the patch value replaces the target wholesale.
    return patch as T;
  }
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = deepMerge((target as Record<string, unknown>)[key], value as DeepPartial<unknown>);
  }
  return out as T;
}

/**
 * Deep-merge a partial presets patch into existing presets. Nested objects merge
 * recursively (so `{ business: { name } }` keeps the other business fields);
 * array fields (competitors, best_articles) are replaced wholesale. Does not
 * mutate `existing`. An `undefined` patch returns `existing` unchanged.
 */
export function mergePresets(
  existing: SetupPresets,
  partial: DeepPartial<SetupPresets> | undefined,
): SetupPresets {
  if (partial === undefined) return existing;
  return deepMerge(existing, partial);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- merge-presets`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/merge-presets.ts apps/api/tests/merge-presets.test.ts
git commit -m "Add mergePresets deep-partial merge helper"
```

---

## Task 2: `OrgRepo.updatePresets` and `OrgRepo.finalize`

**Files:**
- Modify: `packages/shared/db/src/repositories/org.repo.ts`

**Interfaces:**
- Consumes: existing `SetupPresets`, `SetupPresetsSchema`, `ObjectId`, `getDb`/`collection` already in the file.
- Produces:
  - `OrgRepo.updatePresets(id: string, presets: SetupPresets): Promise<void>` — validates full presets, `$set: { presets }`.
  - `OrgRepo.finalize(id: string, presets: SetupPresets): Promise<void>` — validates full presets, `$set: { presets, setup_status: 'setup_complete' }` (atomic).

No new unit test file — these are thin wrappers exercised via the route tests in Task 4 (which mock `@shared/db`), matching how `completeScan`/`updateStatus` are covered. Real-Mongo coverage belongs to the integration suite, out of scope here.

- [ ] **Step 1: Add the two methods**

In `packages/shared/db/src/repositories/org.repo.ts`, insert these methods inside the `OrgRepo` object, immediately after `completeScan` (before the closing `};`):

```typescript
  /** Persist edited presets without changing status (used by PATCH /setup/presets). */
  async updatePresets(id: string, presets: SetupPresets): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const data = SetupPresetsSchema.parse(presets); // validate on write
    await (await collection()).updateOne({ _id: new ObjectId(id) }, { $set: { presets: data } });
  },

  /** Persist final presets and flip the org to `setup_complete` (single update). */
  async finalize(id: string, presets: SetupPresets): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const data = SetupPresetsSchema.parse(presets); // validate on write
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { presets: data, setup_status: 'setup_complete' } },
    );
  },
```

(`SetupPresets`, `SetupPresetsSchema`, `ObjectId`, and `collection` are already imported/defined in this file — no new imports.)

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/db/src/repositories/org.repo.ts
git commit -m "Add OrgRepo.updatePresets and OrgRepo.finalize"
```

---

## Task 3: API schemas for patch / finalize

**Files:**
- Modify: `apps/api/src/schemas/setup.ts`

**Interfaces:**
- Consumes: `SetupPresetsSchema` (already imported), `z` (already imported).
- Produces (all exported):
  - `SetupPresetsPatchSchema` — deep-partial of `SetupPresetsSchema`.
  - `UpdatePresetsBody` = `{ org_id: string, presets: SetupPresetsPatchSchema }`.
  - `FinalizeBody` = `{ org_id: string, presets?: SetupPresetsPatchSchema }`.
  - `PresetsResponse` = `{ presets: SetupPresetsSchema }`.
  - `FinalizeResponse` = `{ setup_status, presets }`.
  - `ConflictResponse` = `{ error: string }`.

- [ ] **Step 1: Add the schemas**

Append to `apps/api/src/schemas/setup.ts` (after `NotFoundResponse`):

```typescript
// Deep-partial of the presets shape: each category is optional, and within a
// category each field is optional. The nested objects under `article_preferences`
// are partialed too, so a client can patch a single deep field.
export const SetupPresetsPatchSchema = z
  .object({
    business: SetupPresetsSchema.shape.business.partial().optional(),
    audience: SetupPresetsSchema.shape.audience.partial().optional(),
    blog: SetupPresetsSchema.shape.blog.partial().optional(),
    article_preferences: z
      .object({
        content_seo: SetupPresetsSchema.shape.article_preferences.shape.content_seo
          .partial()
          .optional(),
        engagement: SetupPresetsSchema.shape.article_preferences.shape.engagement
          .partial()
          .optional(),
      })
      .optional(),
  })
  .openapi('SetupPresetsPatch');

export const UpdatePresetsBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    presets: SetupPresetsPatchSchema,
  })
  .openapi('UpdatePresetsBody');

export const FinalizeBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    presets: SetupPresetsPatchSchema.optional(),
  })
  .openapi('FinalizeBody');

export const PresetsResponse = z
  .object({
    presets: SetupPresetsSchema,
  })
  .openapi('PresetsResponse');

export const FinalizeResponse = z
  .object({
    setup_status: z.literal('setup_complete').openapi({ example: 'setup_complete' }),
    presets: SetupPresetsSchema,
  })
  .openapi('FinalizeResponse');

export const ConflictResponse = z
  .object({
    error: z.string().openapi({ example: 'Setup is not ready to finalize' }),
  })
  .openapi('ConflictResponse');
```

- [ ] **Step 2: Typecheck**

Run: `npm run check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/schemas/setup.ts
git commit -m "Add patch/finalize API schemas for setup presets"
```

---

## Task 4: `loadOwnedOrg` helper + routes + `/details` backfill + tests

**Files:**
- Create: `apps/api/src/lib/load-owned-org.ts`
- Modify: `apps/api/src/routes/setup.ts`
- Modify: `apps/api/tests/setup.test.ts`

**Interfaces:**
- Consumes: `OrgRepo` (`@shared/db`), `Org` type (`@shared/schemas`), `mergePresets` (Task 1), schemas from Task 3, `OrgRepo.updatePresets`/`finalize` (Task 2).
- Produces: `loadOwnedOrg(org_id: string, userId: string): Promise<Org | null>` — returns the org when it exists **and** `org.user_id === userId`, else `null`.

- [ ] **Step 1: Write the failing route tests**

First, in `apps/api/tests/setup.test.ts`, update the `findById` mock so owned orgs carry `user_id: 'user_1'` (the `sub` the test token uses) and add an org owned by someone else. Replace the existing `findById` mock (lines ~41-62) with:

```typescript
    findById: vi.fn(async (id: string) => {
      // Completed org with presets ready, owned by the test user.
      if (id === '6650f1a2b3c4d5e6f7a8b9c0') {
        return {
          id,
          user_id: 'user_1',
          website_url: 'https://example.com',
          setup_status: 'setup_scan_completed',
          presets: presetsFixture,
          created_at: new Date(),
        };
      }
      // Completed org whose scan hasn't produced presets yet (owned by test user).
      if (id === 'no_presets') {
        return {
          id,
          user_id: 'user_1',
          website_url: 'https://example.com',
          setup_status: 'setup_scan_in_progress',
          created_at: new Date(),
        };
      }
      // An already-finalized org owned by the test user (for 409 cases).
      if (id === 'already_complete') {
        return {
          id,
          user_id: 'user_1',
          website_url: 'https://example.com',
          setup_status: 'setup_complete',
          presets: presetsFixture,
          created_at: new Date(),
        };
      }
      // An org owned by a DIFFERENT user (for ownership 404 cases).
      if (id === 'other_users_org') {
        return {
          id,
          user_id: 'someone_else',
          website_url: 'https://example.com',
          setup_status: 'setup_scan_completed',
          presets: presetsFixture,
          created_at: new Date(),
        };
      }
      return null;
    }),
    updatePresets: vi.fn(async () => {}),
    finalize: vi.fn(async () => {}),
```

Then add these tests inside the `describe('setup routes', ...)` block:

```typescript
  test('GET /details returns 404 for an org owned by another user', async () => {
    const res = await client.api.v0.setup.details.$get(
      { query: { org_id: 'other_users_org' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(404);
  });

  test('PATCH /presets requires auth', async () => {
    const res = await client.api.v0.setup.presets.$patch({
      json: { org_id: '6650f1a2b3c4d5e6f7a8b9c0', presets: { business: { name: 'New' } } },
    });
    expect(res.status).toBe(401);
  });

  test('PATCH /presets merges a partial edit and returns full presets', async () => {
    const res = await client.api.v0.setup.presets.$patch(
      {
        json: {
          org_id: '6650f1a2b3c4d5e6f7a8b9c0',
          presets: { business: { name: 'Renamed Co' } },
        },
      },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const json = await res.json();
    expect(json.presets.business.name).toBe('Renamed Co');
    expect(json.presets.business.language).toBe('English'); // sibling preserved
    expect(OrgRepo.updatePresets).toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.objectContaining({
        business: expect.objectContaining({ name: 'Renamed Co', language: 'English' }),
      }),
    );
  });

  test('PATCH /presets returns 404 for an org owned by another user', async () => {
    const res = await client.api.v0.setup.presets.$patch(
      { json: { org_id: 'other_users_org', presets: { business: { name: 'Hijack' } } } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(404);
  });

  test('PATCH /presets returns 409 when scan is not yet completed', async () => {
    const res = await client.api.v0.setup.presets.$patch(
      { json: { org_id: 'no_presets', presets: { business: { name: 'Early' } } } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(409);
  });

  test('POST /finalize requires auth', async () => {
    const res = await client.api.v0.setup.finalize.$post({
      json: { org_id: '6650f1a2b3c4d5e6f7a8b9c0' },
    });
    expect(res.status).toBe(401);
  });

  test('POST /finalize flips status to setup_complete without edits', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      { json: { org_id: '6650f1a2b3c4d5e6f7a8b9c0' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const json = await res.json();
    expect(json.setup_status).toBe('setup_complete');
    expect(json.presets.business.name).toBe('Example Co');
    expect(OrgRepo.finalize).toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.objectContaining({ business: expect.objectContaining({ name: 'Example Co' }) }),
    );
  });

  test('POST /finalize applies a final edit then flips status', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      {
        json: {
          org_id: '6650f1a2b3c4d5e6f7a8b9c0',
          presets: { business: { name: 'Final Co' } },
        },
      },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(200);
    if (res.status !== 200) throw new Error('expected 200');

    const json = await res.json();
    expect(json.presets.business.name).toBe('Final Co');
    expect(OrgRepo.finalize).toHaveBeenCalledWith(
      '6650f1a2b3c4d5e6f7a8b9c0',
      expect.objectContaining({ business: expect.objectContaining({ name: 'Final Co' }) }),
    );
  });

  test('POST /finalize returns 404 for an org owned by another user', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      { json: { org_id: 'other_users_org' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(404);
  });

  test('POST /finalize returns 409 when already complete', async () => {
    const res = await client.api.v0.setup.finalize.$post(
      { json: { org_id: 'already_complete' } },
      { headers: await authHeader() },
    );
    expect(res.status).toBe(409);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- setup`
Expected: FAIL — the `.presets`/`.finalize` client paths don't exist yet (type errors) and routes 404/return wrong shapes.

- [ ] **Step 3: Implement the ownership helper**

Create `apps/api/src/lib/load-owned-org.ts`:

```typescript
import { OrgRepo } from '@shared/db';
import type { Org } from '@shared/schemas';

/**
 * Load an org only if it belongs to the given user. Returns `null` when the org
 * is missing OR owned by someone else — callers map both to 404 so org
 * existence is never leaked across accounts.
 */
export async function loadOwnedOrg(org_id: string, userId: string): Promise<Org | null> {
  const org = await OrgRepo.findById(org_id);
  if (!org || org.user_id !== userId) return null;
  return org;
}
```

- [ ] **Step 4: Wire the routes and backfill `/details`**

In `apps/api/src/routes/setup.ts`:

(a) Update imports at the top:

```typescript
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { OrgRepo } from '@shared/db';
import { enqueueScanTask } from '../clients/sqs';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { mergePresets } from '../lib/merge-presets';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/setup';
```

(b) Replace the `/details` handler body so it uses `loadOwnedOrg`. Change the handler from:

```typescript
    async (c) => {
      const { org_id } = c.req.valid('query');
      const org = await OrgRepo.findById(org_id);
      if (!org?.presets) {
        return c.json({ error: 'Setup details not available' }, 404);
      }
      return c.json({ presets: org.presets }, 200);
    },
```

to:

```typescript
    async (c) => {
      const { org_id } = c.req.valid('query');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org?.presets) {
        return c.json({ error: 'Setup details not available' }, 404);
      }
      return c.json({ presets: org.presets }, 200);
    },
```

(c) Chain two new routes. Change the end of the `/details` `.openapi(...)` call from `);` followed by `export default setup;` to `)` and append the two new `.openapi(...)` calls, then `;` and the export:

```typescript
  )
  .openapi(
    createRoute({
      tags: ['setup'],
      method: 'patch',
      path: '/presets',
      summary: 'Edit generated presets',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.UpdatePresetsBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.PresetsResponse } },
          description: 'Presets updated',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.ConflictResponse } },
          description: 'Org is not in a state that allows editing',
        },
      },
    }),
    async (c) => {
      const { org_id, presets } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) {
        return c.json({ error: 'Setup details not available' }, 404);
      }
      if (org.setup_status !== 'setup_scan_completed' || !org.presets) {
        return c.json({ error: 'Setup is not ready to edit' }, 409);
      }
      const merged = mergePresets(org.presets, presets);
      await OrgRepo.updatePresets(org_id, merged);
      return c.json({ presets: merged }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['setup'],
      method: 'post',
      path: '/finalize',
      summary: 'Finalize setup',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.FinalizeBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.FinalizeResponse } },
          description: 'Setup finalized; org advanced to setup_complete',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not found or not owned by the caller',
        },
        409: {
          content: { 'application/json': { schema: schemas.ConflictResponse } },
          description: 'Org is not in a state that allows finalizing',
        },
      },
    }),
    async (c) => {
      const { org_id, presets } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) {
        return c.json({ error: 'Setup details not available' }, 404);
      }
      if (org.setup_status !== 'setup_scan_completed' || !org.presets) {
        return c.json({ error: 'Setup is not ready to finalize' }, 409);
      }
      const merged = mergePresets(org.presets, presets);
      await OrgRepo.finalize(org_id, merged);
      return c.json({ setup_status: 'setup_complete' as const, presets: merged }, 200);
    },
  );

export default setup;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- setup merge-presets`
Expected: PASS (existing setup tests + new PATCH/finalize/ownership tests + merge tests).

- [ ] **Step 6: Run the full gates**

Run: `npm run lint && npm run check:all && npm test`
Expected: all PASS. (`check:all` confirms the typed client now exposes `api.v0.setup.presets.$patch` and `.finalize.$post`, proving the `AppType` chain picked up the new routes.)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/load-owned-org.ts apps/api/src/routes/setup.ts apps/api/tests/setup.test.ts
git commit -m "Add PATCH /setup/presets and POST /setup/finalize with ownership checks"
```

---

## Task 5: Update PROGRESS.md

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Flip the onboarding-flow items**

In `PROGRESS.md` under "Setup / onboarding flow", change:

```
- ⬜ Editable preset endpoints per category (business / audience / blog / article prefs)
```
to:
```
- ✅ `PATCH /setup/presets` — partial edit of generated presets (deep-merge, ownership-checked)
```

and change:

```
- ⬜ `POST /setup/finalize` — persist + flip status to `setup_complete`
```
to:
```
- ✅ `POST /setup/finalize` — optional final edit + flip status to `setup_complete`
```

Also update the unit-test count line at the bottom (`currently 31 passing`) to the new total reported by `npm test`, and bump the `_Last updated:_` line to `2026-06-29 (+ setup finalize + editable presets)`.

- [ ] **Step 2: Commit**

```bash
git add PROGRESS.md
git commit -m "Update PROGRESS: setup finalize + editable presets done"
```

---

## Self-Review Notes

- **Spec coverage:** PATCH (Task 4) ✓; finalize (Task 4) ✓; deep-merge semantics + array replacement (Task 1) ✓; `loadOwnedOrg` + `/details` backfill (Task 4) ✓; schemas incl. `ConflictResponse` (Task 3) ✓; repo `updatePresets`/`finalize` (Task 2) ✓; 404/409/200 contract (Task 4 tests) ✓; merge + route tests (Tasks 1, 4) ✓.
- **Type consistency:** `mergePresets(existing, partial)`, `loadOwnedOrg(org_id, userId)`, `OrgRepo.updatePresets(id, presets)`, `OrgRepo.finalize(id, presets)` are referenced with identical signatures across tasks.
- **Ordering:** Tasks 1-3 are independent and have no cross-dependencies; Task 4 consumes all three; Task 5 is docs. The `findById` mock gains `user_id` in Task 4 — required because the backfilled ownership check compares `org.user_id` to the token's `sub` (`user_1`).
