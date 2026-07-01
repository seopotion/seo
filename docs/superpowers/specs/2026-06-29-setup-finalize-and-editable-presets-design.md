# Design: `POST /setup/finalize` + editable preset endpoints

_Date: 2026-06-29_

## Goal

Close the back half of the onboarding loop. Today a user can scan a site
(`start_scan` → worker → `setup_scan_completed`) and read the generated presets
(`GET /setup/details`), but cannot **edit** those presets or **finish** setup.
Nothing ever reaches `setup_complete`, the status `GET /core/status` uses to
route to the dashboard. This work adds preset editing and finalization so the
flow runs end to end: login → scan → edit → finalize → dashboard.

## Scope

In scope:

- `PATCH /setup/presets` — partial edit of generated presets.
- `POST /setup/finalize` — optional final edit, then flip to `setup_complete`.
- An ownership check on org-scoped endpoints, backfilled into `GET /setup/details`.

Out of scope (later work):

- Editing settings after onboarding completes (a dashboard concern).
- `GET`/`POST /setup/integrations` (publishing-platform connections — deferred).

## Endpoints

Both are auth-protected (`security: [{ Bearer: [] }]`, `authMiddleware`),
chained onto the existing `OpenAPIHono<AuthEnv>` router in
`apps/api/src/routes/setup.ts`.

### `PATCH /setup/presets`

- Body: `{ org_id: string, presets: <deep-partial presets> }`.
- Behavior: load owned org → require `setup_scan_completed` → deep-merge the
  partial into stored presets → re-validate the **full** `SetupPresetsSchema`
  → persist via `OrgRepo.updatePresets`.
- Response 200: `{ presets }` (the full updated presets).

### `POST /setup/finalize`

- Body: `{ org_id: string, presets?: <deep-partial presets> }`.
- Behavior: load owned org → require `setup_scan_completed` → apply the optional
  partial (same merge) → persist presets **and** flip status to
  `setup_complete` in one atomic update via `OrgRepo.finalize`.
- Response 200: `{ setup_status: 'setup_complete', presets }`.

## Merge semantics

A pure, unit-testable helper `mergePresets(existing, partial)`:

- Recurses into nested objects, so `{ business: { name } }` keeps the other
  `business` fields (`language`, `country`, `description`) and the other
  categories untouched. Recursion must reach the two-level-deep nests under
  `article_preferences` (`content_seo`, `engagement`).
- **Arrays replace wholesale** — `audience.competitors` and
  `blog.best_articles` are set to the provided array, never concatenated.
- The merged result is parsed through the full `SetupPresetsSchema` before
  persistence, so a partial edit can never leave presets incomplete or invalid.

Location: a small util module under `apps/api/src/` (e.g.
`apps/api/src/lib/merge-presets.ts`), imported by the routes and tested directly.

## Ownership

Helper `loadOwnedOrg(org_id, userId)` returns the org, or `null` when the org is
missing **or** `org.user_id !== userId`. Callers treat `null` as **404** (a
not-found response that does not distinguish "missing" from "not yours", to
avoid leaking org existence).

Used by `PATCH /setup/presets`, `POST /setup/finalize`, and backfilled into the
existing `GET /setup/details` (which is currently auth-protected but does not
verify ownership — any valid JWT can read any `org_id`'s presets). Closing that
read gap is part of this work.

Location: alongside the routes (e.g. a helper in `setup.ts` or a small
`apps/api/src/lib/` module). It depends only on `OrgRepo.findById`.

## Schemas (`apps/api/src/schemas/setup.ts`)

- `SetupPresetsPatchSchema` — explicit deep-partial of `SetupPresetsSchema`:
  each top-level category `.partial()`, and the nested `content_seo` /
  `engagement` objects under `article_preferences` also `.partial()`. Built
  explicitly (not via a generic deep-partial) because the nesting is shallow and
  fixed. `.openapi('SetupPresetsPatch')`.
- `UpdatePresetsBody` — `{ org_id, presets: SetupPresetsPatchSchema }`.
- `FinalizeBody` — `{ org_id, presets: SetupPresetsPatchSchema.optional() }`.
- `PresetsResponse` — `{ presets: SetupPresetsSchema }` (PATCH 200).
- `FinalizeResponse` — `{ setup_status, presets }` (finalize 200).
- `ConflictResponse` — `{ error: string }` (shared 409 body).

The existing `NotFoundResponse` is reused for 404s.

## Repository additions (`packages/shared/db/src/repositories/org.repo.ts`)

Two thin methods, matching the existing `completeScan` style (validate on write,
single `updateOne`):

- `updatePresets(id, presets: SetupPresets)` — `SetupPresetsSchema.parse` then
  `$set: { presets }`.
- `finalize(id, presets: SetupPresets)` — `$set: { presets, setup_status:
  'setup_complete' }` (atomic, both fields in one update).

## Status / error contract

| Condition                                          | Status | Body              |
| -------------------------------------------------- | ------ | ----------------- |
| Org missing or not owned by caller                 | 404    | `{ error }`       |
| Status not `setup_scan_completed`                  | 409    | `{ error }`       |
| (in-progress, not-started, or already complete)    |        |                   |
| Success                                            | 200    | endpoint response |

Strict onboarding window: once `setup_complete`, both PATCH and finalize return
409. Editing post-onboarding is out of scope.

## Testing (Vitest, mock `@shared/db`)

- `mergePresets` unit tests: nested object merge preserves siblings; array
  fields replace wholesale; empty/`undefined` partial is a no-op; two-level
  nest under `article_preferences` merges correctly.
- Route tests (`testClient` / `app.request`, mocked `OrgRepo`):
  - PATCH: success (returns merged presets), 404 when not owner, 409 when status
    is not `setup_scan_completed`.
  - finalize: success with edits, success without edits (status flips), 404 not
    owner, 409 wrong status.
  - `/details` ownership backfill: 404 when org belongs to another user.

## Always-green gates

`npm run lint`, `npm run check:all`, `npm test` must pass before the work is
considered done.
