# Article / Keyword Data Model — Design

_2026-07-02_

## Purpose

Introduce the persistent data model for **keywords** (planner opportunities) and
**articles**, and swap the dashboard's mock read endpoints to real database reads. This is
the keystone that unblocks the dashboard's real-data work: most of [#11](https://github.com/seopotion/seo/issues/11)
(swap mock reads → real) and the read half of the Articles epic [#19](https://github.com/seopotion/seo/issues/19)
depend on these collections existing.

The data **shapes** are already specified in [`design/product-flow.md`](../../../design/product-flow.md)
§2.1 (Content Planner), §2.2 (Content History), and §2.2.1 (Article editor). This spec turns
that mapping into concrete schemas, repositories, indexes, wired endpoints, and seed tooling.

## Scope

**In scope**

- `KeywordSchema` + `ArticleSchema` entities in `@shared/schemas`.
- `KeywordRepo` + `ArticleRepo` in `@shared/db`, plus their indexes.
- Swap the existing mock dashboard read endpoints to real DB reads (planner, article
  list/detail, Home published/planned counts).
- `db seed` CLI subcommand so the frontend can build populated states against a real DB.

**Explicitly deferred (not this spec)**

- The keyword-generation worker and `POST /dashboard/keywords/research`.
- `PATCH /dashboard/keywords/:id` (reschedule / custom instructions).
- Article **generation** (keyword → article) and **publish** (article → CMS) workers.
- `publish_error` flag on articles (belongs with the publish worker).
- The AI editing layer (chat rewrite, per-block regen, inline media synthesis).
- Rich keyword classification fields: `article_type`, `article_subtype`, `type_metadata`,
  `quality_questions`, provenance (`generation_source`/`generation_context`/
  `generation_filters`) — parity-gaps **G10/G11**.

Because no writer worker exists yet, the real reads return **empty** for a fresh org. The
`db seed` command is how devs and the frontend get populated data.

## Entities (`@shared/schemas`)

Both follow the existing `OrgSchema` conventions: `id` is the stringified Mongo `_id` (the
raw `_id` never leaves the repository layer), timestamps are `z.date()`, and a
`Create…Input` type omits the server-assigned `id`/`created_at`.

### `KeywordSchema` — collection `keywords`

One org-scoped record per calendar opportunity. A single collection (no separate
pool/scheduled split — the baseline collapses them; `status` is an enum with only
`'scheduled'` today, leaving room to grow).

```
id:             string
org_id:         string
keyword:        string
status:         'scheduled'
scheduled_date: string          // yyyy-mm-dd (date-only, not a timestamp)
search_volume:  number (int)
difficulty:     number (int)
article_id:     string | null   // null until article generation lands
created_at:     Date
```

`CreateKeywordInput = KeywordSchema.omit({ id, created_at })`.

### `ArticleSchema` — collection `articles`

```
id:                 string
org_id:             string
keyword_id:         string
title:              string          // SEO title — distinct from `keyword`
slug:               string
keyword:            string          // denormalized display string (history table shows it without a join)
meta_description:   string
featured_image_url: string
content:            string          // markdown body
difficulty:         number (int)
search_volume:      number (int)
status:             'generated' | 'published' | 'deleted'
created_at:         Date
published_at:       Date | null
```

`CreateArticleInput = ArticleSchema.omit({ id, created_at })`.

**Decisions**

- `keyword` is denormalized onto the article so the Content History table renders without a
  join. The canonical link is `keyword_id` (+ the reverse `keyword.article_id`).
- `title` is stored separately from `keyword` — the generated article gets its own SEO title
  (product-flow.md §2.2 confirmed `article.title` ≠ `keyword`).
- `publish_error` is **not** included; it lands with the publish worker.

## Repositories (`@shared/db`)

Same pattern as `OrgRepo`: a module-scoped collection accessor, a `toEntity` mapper that does
`_id` → `id` and `Schema.parse` at the boundary, and `parse`-on-write for `create`.

### `KeywordRepo`

- `listByOrg(orgId): Promise<Keyword[]>` — ordered by `scheduled_date asc`.
- `countScheduled(orgId): Promise<number>` — `status: 'scheduled'` count (Home "planned").
- `create(input: CreateKeywordInput): Promise<Keyword>` — used by seed.

### `ArticleRepo`

- `listByOrg(orgId, { status?, limit, offset }): Promise<{ articles: Article[]; total: number }>`
  — ordered `created_at desc`; `total` is the filtered count.
- `findById(id): Promise<Article | null>`.
- `countByStatus(orgId, status): Promise<number>` — Home "published" = `countByStatus(org, 'published')`.
- `create(input: CreateArticleInput): Promise<Article>` — used by seed.

Ownership is enforced at the route layer (via the org the caller owns), not inside the repo —
consistent with how `loadOwnedOrg` guards the setup/settings routes.

## Indexes (`ensure-indexes.ts`)

Add (the `articles` line already exists commented-out):

```ts
await db.collection('articles').createIndex({ org_id: 1, created_at: -1 });
await db.collection('articles').createIndex({ org_id: 1, status: 1 });
await db.collection('keywords').createIndex({ org_id: 1, scheduled_date: 1 });
```

`createIndex` is idempotent; these run at deploy time via the existing DB-init custom
resource, never lazily per request.

## Wiring the read endpoints (`apps/api`)

Swap the four mock handlers to real reads. Each becomes org-scoped: the caller passes
`org_id` and the handler resolves ownership with `loadOwnedOrg` (returns 404 on
missing/other-owner), exactly as the `/dashboard/settings/*` endpoints now do.

| Endpoint | Real read |
| --- | --- |
| `GET /dashboard/planner` | `KeywordRepo.listByOrg(org_id)` |
| `GET /dashboard/articles` (status filter + limit/offset) | `ArticleRepo.listByOrg(org_id, …)` |
| `GET /dashboard/articles/:id` | `ArticleRepo.findById` (ownership-checked → 404) |
| `GET /dashboard/articles/published` | `ArticleRepo.countByStatus(org_id, 'published')` |
| `GET /dashboard/articles/planned` | `KeywordRepo.countScheduled(org_id)` |

`GET /dashboard/articles/best` and `/integrations/connected` are **unchanged** here — they
stay gated/empty (they belong to the GSC work [#12](https://github.com/seopotion/seo/issues/12)
and integrations [#7](https://github.com/seopotion/seo/issues/7)).

**Boundary mapping.** Entity timestamps are `Date`; the existing API response schemas
(`ArticleListItem`, `ArticleDetailResponse`, `PlannerKeyword`) already use `z.string()`, so
the handlers serialize `Date` → ISO string (`scheduled_date` is already a date-only string
and passes through). The API response schemas in `apps/api/src/schemas/dashboard.ts` are
re-derived from the new `@shared/schemas` entities where practical, so the entity stays the
single source of truth (same approach the settings schemas take with `SetupPresetsSchema`).

**Contract change.** These GETs currently take no `org_id`; org-scoping adds an `org_id`
query param, so the typed frontend calls change. This is consistent with the direction
`/dashboard/settings/*` already went, and is called out for the frontend (epic #19 / #20).

**Seam cleanup.** `MOCK_PLANNER`, `MOCK_ARTICLES`, and `MOCK_ARTICLE_DETAILS` are removed
from `apps/api/src/mocks/dashboard.ts` once their readers are on the DB (the module's sample
content moves into the seed command). If the file has no remaining exports, it is deleted.

## Seed tooling (`apps/cli`)

Add a `db seed` subcommand to the existing citty CLI (alongside `db init`):

```
npm run cli -- db seed --user <userId>
```

Inserts, into the configured Mongo, for the given user:

- one demo org (`setup_status: 'setup_complete'`, with `presets`),
- ~5 scheduled keywords (a mix of `article_id: null` and one linked),
- ~2 articles (one `generated`, one `published`) with consistent `keyword_id` ↔ `article_id`
  back-links.

The seed content reuses the sample data that previously lived in the API mocks, so the
frontend's populated planner/history states render exactly as before — now backed by real
reads. `--output json` is supported for agents, matching the other CLI commands.

## Testing

- **Repo unit tests** — mock `@shared/db` (`vi.mock`), assert ordering, filtering, and the
  `_id`↔`id` / Zod-parse boundary.
- **Repo integration tests** — against real Mongo via the existing `npm run test:integration`
  harness (needs `docker compose up -d mongo`), mirroring `org.repo.integration.test.ts`.
- **Endpoint tests** (`apps/api/tests/dashboard.test.ts`) — rewrite the planner/history reads
  to the settings-style stateful repo mocks: assert real reads, the status filter + paging,
  ownership 404, and the **empty-collection** responses (`{ keywords: [] }`,
  `{ articles: [], total: 0 }`, counts `0`).
- **Seed** — a smoke test that `db seed` produces documents the read endpoints then return.

## Success criteria

- `KeywordSchema`/`ArticleSchema` + `KeywordRepo`/`ArticleRepo` exist, exported from
  `@shared/schemas` / `@shared/db`, with indexes ensured.
- The five listed endpoints read real data; a fresh org returns empty; a seeded org returns
  the seeded planner cards, history rows, article detail, and correct Home counts.
- `npm run cli -- db seed --user <id>` populates a demo org end-to-end.
- Mock fixtures for planner/articles are gone from the API.
- `npm run lint`, `npm run check:all`, `npm test` green; repo integration tests pass against
  Mongo.
