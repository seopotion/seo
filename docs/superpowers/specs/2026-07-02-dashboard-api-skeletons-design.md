# Dashboard API skeletons (populated mock data)

_2026-07-02_

## Goal

Unblock frontend dashboard work by scaffolding the remaining baseline dashboard
endpoints — schemas + route skeletons returning **populated mock data** — so the
FE can build both empty and populated states against real, type-checked shapes.
The four Home endpoints (`/articles/{best,published,planned}`,
`/integrations/connected`) already exist; this batch adds the Content Planner,
Content History, Articles Settings, and General Settings surfaces mapped in
[`design/product-flow.md`](../../../design/product-flow.md) §2.

Non-goals (explicitly deferred, not in this batch): subscription status +
`requirePaid` gate, Integrations CRUD, keyword mutations (`POST /keywords/research`,
`PATCH /keywords/:id`), and any real persistence or worker behavior.

## Conventions

- All endpoints live in the existing `dashboard` router (`apps/api/src/routes/dashboard.ts`),
  mounted at `/api/v0/dashboard`, chained with `.openapi()` so `AppType` captures them.
- All Bearer-protected via `authMiddleware` (`security: [{ Bearer: [] }]`).
- Schemas extend `apps/api/src/schemas/dashboard.ts`; settings shapes **reuse**
  `SetupPresetsSchema` sub-shapes (`@shared/schemas`) — single source of truth.
- Handlers return fixtures from a new `apps/api/src/mocks/dashboard.ts` module —
  the explicit swap-out point when real reads land. No DB access.
- The design doc's `/dashboard/v0/*` notation predates the real mount; actual
  paths are `/api/v0/dashboard/*`.

## Endpoints

### Content Planner (§2.1)

- `GET /planner` → `{ keywords: PlannerKeyword[] }`
  - `PlannerKeyword = { id, keyword, status, scheduled_date, search_volume, difficulty, article_id: string | null }`
  - Mock: ~5 scheduled keywords, mixing generated (`article_id` set) and
    not-yet-generated (`article_id: null`) so FE can build both card affordances.

### Content History (§2.2, read-only)

- `GET /articles?status=&limit=&offset=` → `{ articles: ArticleListItem[], total }`
  - `ArticleListItem = { id, title, slug, keyword, status, difficulty, search_volume, featured_image_url, created_at, published_at: string | null }`
  - Optional `status` filter; `limit`/`offset` pagination over the mock set.
- `GET /articles/:id` → `ArticleDetail` (§2.2.1 record)
  - `{ id, keyword_id, title, slug, meta_description, featured_image_url, content, status, created_at, published_at: string | null }` — `content` is markdown.
  - 404 (`NotFoundResponse` shape) for an unknown id.

### Articles Settings (§2.3)

- `GET /settings/articles` → `{ article_preferences }` (reuses
  `SetupPresetsSchema.shape.article_preferences`).
- `PATCH /settings/articles` → partial `article_preferences` (mirrors the
  `SetupPresetsPatchSchema` partial pattern), deep-merged via existing
  `mergePresets` against the mock baseline, echoes updated `{ article_preferences }`.
  **Non-persisting skeleton.**

### General Settings (§2.6)

- `GET /settings/general` → `{ business, audience }` (reuses `SetupPresetsSchema`
  sub-shapes; `audience` already carries `target` + `competitors[]`).
- `PATCH /settings/general` → partial merge of `business` / `audience`, echoes
  updated `{ business, audience }`. **Non-persisting skeleton.**

## Path-collision handling

`GET /articles/:id` coexists with the existing static `/articles/{best,published,planned}`.
Hono matches static segments before params, so those keep resolving. A regression
test asserts `/articles/best` still returns its gated shape after `:id` is added.

## Testing

Extend `apps/api/tests/dashboard.test.ts`:

- 401 without a token for each new endpoint.
- Populated-shape assertions for each GET (non-empty planner/articles, filled settings).
- PATCH echo-merge for both settings endpoints (a patched field comes back changed,
  siblings unchanged).
- `GET /articles/:id` → 200 for a known mock id, 404 for an unknown id.
- Regression: `/articles/best` still returns `{ articles: [], gated: true }`.

## File organization

One `routes/dashboard.ts` + one `schemas/dashboard.ts` (matches the
core/setup/dashboard one-file-per-router convention, ~11 endpoints, sectioned).
Mock fixtures split into `mocks/dashboard.ts` for readability and easy removal.
