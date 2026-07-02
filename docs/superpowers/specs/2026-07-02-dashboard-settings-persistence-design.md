# Dashboard Settings persistence — design

_Date: 2026-07-02_

## Problem

The dashboard Settings endpoints are stubbed. `GET`/`PATCH` `/dashboard/settings/articles`
and `/dashboard/settings/general` read from and merge against an in-memory `MOCK_PRESETS`
fixture (`apps/api/src/mocks/dashboard.ts`); the PATCH handlers deep-merge but throw the
result away (non-persisting). Meanwhile the org's real onboarding presets are already
persisted in Mongo (`org.presets`, a `SetupPresetsSchema`) and edited via the `setup`
routes. These Settings endpoints are just the dashboard-side view onto that same data, so
they can be made real with no new collections.

Out of scope: the planner / articles / article-detail endpoints. Those read article and
keyword records that nothing writes yet (the worker's `scanWebsite()` only generates
presets). Making them real requires building a data producer first — a separate backend
epic. Their mock fixtures stay untouched.

## Decisions (locked)

- **Settings first** — persist the four settings handlers; leave planner/articles on mocks.
- **Server-side single-org resolution** — the dashboard routes take no `org_id`; they
  resolve the caller's org from the JWT (`c.get('auth').userId`). Baseline is single-org.
- **Resolution semantics** — resolve to the caller's **newest `setup_complete` org**
  (sort by `created_at` desc). No completed org → `404`. Multiple → newest wins (no error).

## Design

### 1. Org resolution — new repo method

Add to `OrgRepo` (`packages/shared/db/src/repositories/org.repo.ts`):

```ts
/** Newest org that has finished setup, for dashboard reads. Null if none. */
async findLatestCompletedByUser(userId: string): Promise<Org | null> {
  const doc = await (await collection()).findOne(
    { user_id: userId, setup_status: 'setup_complete' },
    { sort: { created_at: -1 } },
  );
  return doc ? toEntity(doc) : null;
}
```

Doing the sort + single-doc fetch in Mongo is cleaner and cheaper than pulling all the
user's orgs into JS and sorting there. Mirrors the existing `findActiveByUserAndUrl`
shape (filtered `findOne`, `toEntity`).

### 2. A small resolver helper for the handlers

The four handlers share the same "resolve the org or 404" step, including the defensive
missing-presets case. Factor it into one helper alongside `load-owned-org.ts`:

`apps/api/src/lib/resolve-dashboard-org.ts`

```ts
import { OrgRepo } from '@shared/db';
import type { Org, SetupPresets } from '@shared/schemas';

/**
 * Resolve the org whose settings the dashboard is showing: the caller's newest
 * completed org, and only if it actually carries presets. Returns null when there
 * is no completed org or (defensively) it has no presets — handlers map null to 404.
 */
export async function resolveDashboardPresets(
  userId: string,
): Promise<{ org: Org; presets: SetupPresets } | null> {
  const org = await OrgRepo.findLatestCompletedByUser(userId);
  if (!org || !org.presets) return null;
  return { org, presets: org.presets };
}
```

Returning both `org` (for `org.id` on PATCH) and the narrowed non-optional `presets`
keeps the handlers free of repeated null checks.

### 3. Handler bodies (`apps/api/src/routes/dashboard.ts`)

Replace the four settings handlers. Pattern (shown for `general`; `articles` is analogous):

```ts
// GET /settings/general
async (c) => {
  const { userId } = c.get('auth');
  const resolved = await resolveDashboardPresets(userId);
  if (!resolved) return c.json({ error: 'Settings not available' }, 404);
  const { presets } = resolved;
  return c.json({ business: presets.business, audience: presets.audience });
}

// PATCH /settings/general
async (c) => {
  const { userId } = c.get('auth');
  const resolved = await resolveDashboardPresets(userId);
  if (!resolved) return c.json({ error: 'Settings not available' }, 404);
  const patch = c.req.valid('json');
  const merged = mergePresets(resolved.presets, patch);
  await OrgRepo.updatePresets(resolved.org.id, merged);
  return c.json({ business: merged.business, audience: merged.audience });
}
```

`articles` GET returns `{ article_preferences }`; its PATCH wraps the body as
`mergePresets(presets, { article_preferences: patch })` and returns
`{ article_preferences: merged.article_preferences }` — same shape the current mock
handler already produces.

This is exactly the `setup.ts` PATCH pattern (`mergePresets` → `OrgRepo.updatePresets`),
minus the explicit `org_id` param, which is now resolved server-side.

### 4. Route definitions — add 404

Add a dedicated `SettingsNotFoundResponse` to `apps/api/src/schemas/dashboard.ts` — a
`z.object({ error: z.string() })` with `.openapi('SettingsNotFoundResponse')` and an
example of `'Settings not available'`. Not reusing `ArticleNotFoundResponse`: its OpenAPI
component name and `'Article not found'` example would be misleading on a settings route,
and a distinct component keeps the generated spec honest. Each of the four settings
`createRoute` blocks gains a `404` response entry pointing at it; all four handlers become
`async`.

### 5. Cleanup

`MOCK_PRESETS` becomes unused → delete it from `apps/api/src/mocks/dashboard.ts` and drop
its now-unused imports (`SetupPresets` type, if only used there). `MOCK_PLANNER`,
`MOCK_ARTICLES`, `MOCK_ARTICLE_DETAILS` stay. Remove the `MOCK_PRESETS` import in
`dashboard.ts`; keep `mergePresets`.

## Data flow

```
JWT (userId)
  -> resolveDashboardPresets(userId)
       -> OrgRepo.findLatestCompletedByUser  (newest setup_complete org)
       -> null if none / no presets  -> 404
  GET   -> return presets slice
  PATCH -> mergePresets(presets, patch) -> OrgRepo.updatePresets(org.id, merged) -> return slice
```

## Error handling

- No completed org, or completed org without presets → `404 { error: 'Settings not available' }`.
- Unauthorized (no/invalid Bearer) → `401` from `authMiddleware` (unchanged).
- Invalid PATCH body → `400` from zod-openapi validation (unchanged).
- `OrgRepo.updatePresets` re-validates the merged presets through `SetupPresetsSchema` on
  write (existing behavior), so a malformed merge fails loudly at the DB boundary.

## Testing (`apps/api/tests/dashboard.test.ts`)

Follows existing conventions: `testClient<AppType>(app)`, `@shared/db` mocked via `vi.mock`,
spies via `vi.hoisted`. Per settings endpoint:

- Authed + resolvable completed org (mock `findLatestCompletedByUser` → an org with presets)
  → 200 with the real presets slice.
- PATCH → asserts `OrgRepo.updatePresets` called once with `(org.id, deepMergedPresets)` and
  the response reflects the merge (partial patch leaves untouched fields intact).
- No completed org (`findLatestCompletedByUser` → null) → 404.
- Completed org but `presets` undefined → 404 (defensive branch).
- Unauth → 401 (already covered by existing suite; keep).

Newest-of-multiple selection is a repo concern (Mongo `sort`); assert at the handler level
only that the resolved org's presets are what's returned. A repo-level unit/integration test
for the sort is optional and not required for this change.

## Gates

`npm run lint`, `npm run check:all`, `npm test` all green before PR into `dev`.
Branch: `fcanozkan/dashboard-settings-persistence`.
