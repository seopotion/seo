# Task: build the persisted article editor — API contract + full frontend wiring

You are working in the `seo` TypeScript monorepo (npm workspaces) at `/Users/alperyazagan/Repos/seo`.
**Read `/CLAUDE.md` first** — it defines the typed Hono RPC client chain, Biome formatting, the
branch/PR workflow, and the coding principles (simplicity, surgical changes, no speculative
abstraction) you must follow.

Line numbers below were verified at commit `41f69cc` on branch `frontend2`. **Re-verify each one by
reading the file before you edit** — do not trust them blind.

---

## Goal

The article editor modal on `/content-planner` is a UI-only mock today: it fabricates article
content client-side from `editor.mock.*` i18n strings and "saves" into React state
(`createArticleEditorDraft` / `saveDraftLocally` in `ArticleEditorModal.tsx`).

Make the real flow work end to end: open a planner card that has an `article_id` → the generated
article loads from the API → edit → Save → persisted, with the server's `updated_at` reflected back.

**Sequencing decision (already made — follow it):** this work lands the **API contract** as well as
the frontend. In this repo the frontend's types are *inferred from* the backend's route
declarations (`hc<AppType>`), so there is no way to write real client calls against routes that
don't exist. Rather than hand-roll a throwaway parallel contract in `apps/web`, you will declare the
routes in `apps/api` first, then build the frontend against the genuine typed client.

Backend issue [#74](https://github.com/seopotion/seo/issues/74) specifies this API and is assigned
to `ozykhan`. **Read it first — `gh issue view 74`** — and treat its request/response examples,
validation rules, and auth/ownership rules as the spec. See "Coordination" at the bottom: you must
not silently duplicate work someone else may already be doing.

---

## Stage 0 — check what already exists

```bash
gh issue view 74 --json state,title,assignees
git fetch origin && git log --oneline origin/dev -20
grep -n "meta_title\|images_status\|updated_at" apps/api/src/schemas/dashboard.ts
grep -n "'patch'" -B 3 -A 3 apps/api/src/routes/dashboard.ts
```

If some or all of the API has already landed on `dev`, **skip the corresponding stage below and
build on it** — do not re-implement or "improve" it. Adapt the frontend to the shapes that actually
shipped, since #74's issue body is a proposal, not a guarantee.

---

## Stage 1 — `@shared/schemas`

### 1a. Single-source the meta constants

`ArticleEditorModal.tsx:22-24` hardcodes `META_TITLE_LIMIT = 60`,
`META_DESCRIPTION_TARGET_MIN = 120`, `META_DESCRIPTION_TARGET_MAX = 160`, duplicating
`META_TITLE_MAX` / `META_DESCRIPTION_MIN` / `META_DESCRIPTION_MAX` in
`packages/shared/generation/src/config.ts:3-5`.

**`apps/web` must not import `@shared/generation`** — its `src/index.ts:4` re-exports
`generateArticle`, which pulls `@shared/providers` (LLM SDK clients) into a client bundle. It is
also not currently a web dependency.

So:
- Add the three constants to `packages/shared/schemas/src/article.ts` (already an `apps/web`
  dependency — verify in `apps/web/package.json`), with a one-line comment.
- Change `packages/shared/generation/src/config.ts` to re-export them from `@shared/schemas`, so
  `validateArticle()` (`packages/shared/generation/src/validate.ts`) and every existing import path
  keep working untouched. These are values, so plain `export { … } from` is correct under
  `verbatimModuleSyntax`.
- Confirm no other copies exist:
  `grep -rn "META_TITLE_MAX\|META_DESCRIPTION_MIN\|META_DESCRIPTION_MAX\|META_TITLE_LIMIT" --include=*.ts --include=*.tsx .`

### 1b. Add `updated_at` to the article entity

`ArticleSchema` (`packages/shared/schemas/src/article.ts:45-68`) has `created_at` and
`published_at` but **no `updated_at`** — the editor's "last saved" state needs it.

Add it **defaulted so pre-existing documents still parse**, exactly like the `images_status` and
`video` fields already do (`:62-67` — read their comments and match the style):
`updated_at: z.date().nullable().default(null)`.

Null means "never edited since generation". Do not backfill; do not add a migration.

Note `CreateArticleInput` (`:72`) omits `id`/`created_at`; decide whether `updated_at` should also
be omitted there (it should — the server owns it) and adjust consistently.

---

## Stage 2 — `@shared/db`

Add an update method to `packages/shared/db/src/repositories/article.repo.ts`. Match the existing
methods' style: `ObjectId.isValid` guard, `$set`, and a return type the route can use directly.

```
updateContent(id, patch: { title, slug, meta_title, meta_description, content }): Promise<Article | null>
```

- Sets the five fields plus `updated_at: new Date()`.
- Use `findOneAndUpdate` with `{ returnDocument: 'after' }` so the route gets the updated entity in
  one round trip, then map it through the file's existing `toEntity()` so it's Zod-validated on the
  way out (this is the repo-layer contract — see CLAUDE.md § Data layer).
- Returns `null` for an unknown/invalid id.

Add integration coverage in `packages/shared/db/tests/article.repo.integration.test.ts` if that file
exists; if it doesn't, follow the pattern of an existing `*.repo.integration.test.ts` (e.g.
`candidate.repo.integration.test.ts`). These need `docker compose up -d mongo` and run via
`npm run test:integration`.

---

## Stage 3 — `apps/api` route contract

### 3a. Widen the detail response

- `apps/api/src/schemas/dashboard.ts:184-199` — add `meta_title`, `keyword`, `images_status`, and
  `updated_at` to `ArticleDetailResponse`. `images_status` should reuse the `IMAGES_STATUSES` enum
  from `@shared/schemas` rather than a new literal list. `updated_at` is `z.string().nullable()`
  (ISO, or null — see 1b).
- `apps/api/src/routes/dashboard.ts:32-46` — `toArticleDetail()` must return those four fields.
  `updated_at: a.updated_at ? a.updated_at.toISOString() : null`, matching how `published_at` is
  already handled on `:43`.

### 3b. PATCH body + validation error schemas

Add to `apps/api/src/schemas/dashboard.ts`, next to the existing article schemas:

- `ArticleUpdateBody` — `title`, `slug`, `meta_title`, `meta_description`, `content`, all
  `z.string()`. **Keep the Zod schema permissive** (see the next paragraph for why) and give it
  `.openapi('ArticleUpdate')` per repo convention.
- `ArticleValidationErrorResponse` — `{ error: z.string(), fields: z.record(z.string(), z.string()) }`,
  `.openapi('ArticleValidationError')`.

**Important:** `apps/api` has **no `defaultHook`** (verify: `grep -rn defaultHook apps/api/src`), so
a Zod request-schema failure returns `@hono/zod-openapi`'s default error shape — *not* #74's
`{ error, fields }`. To deliver the specified body, do the length/emptiness checks **in the
handler** and return the custom 400 yourself. Declare the 400 response *with* the
`ArticleValidationErrorResponse` content schema (unlike `keywords.ts:95`, which declares bare
descriptions) so the typed client exposes the `fields` object to the frontend.

Validate exactly the rules in #74, importing the constants from `@shared/schemas` (Stage 1a):
`title`/`slug`/`content` non-empty **after trimming**, `meta_title` ≤ `META_TITLE_MAX`,
`meta_description` between `META_DESCRIPTION_MIN` and `META_DESCRIPTION_MAX`. Trimming matters: the
frontend validates with `.trim()`, so a bare `.min(1)` would let `"   "` through and desync the two
sides.

### 3c. The route

Add a `patch` `/articles/{id}` `.openapi(...)` to the chained router in
`apps/api/src/routes/dashboard.ts`, immediately after the existing `get /articles/{id}`
(`:403-434`) — keep the chain unbroken, that's what builds `AppType`.

- `security: [{ Bearer: [] }]`, `middleware: [authMiddleware] as const`, `request: { params:
  schemas.ArticleParams, body: {...} }`
- Ownership: reuse the exact pattern at `:426-431` — `ArticleRepo.findById`, then
  `loadOwnedOrg(article.org_id, userId)`; a missing article and a cross-org article both return
  `404 { error: 'Article not found' }`. Keep that comment's intent (never leak existence).
- Responses: `200` = `ArticleDetailResponse`, `400` = `ArticleValidationErrorResponse`,
  `404` = `ArticleNotFoundResponse`.
- On success return `toArticleDetail(updated)` — the *same* shape as GET, per #74.

### 3d. Backend tests

Extend `apps/api/tests/dashboard.test.ts`. It already mocks `ArticleRepo` with an in-memory
`articles` array (~`:244-255`) and drives HTTP via `testClient` — follow that, add `updateContent`
to the mock. Cover #74's four cases: success, validation failure (assert the `fields` body), not
found, and cross-org access. Also assert GET now returns `meta_title` / `keyword` /
`images_status` / `updated_at`.

**Checkpoint:** `npm run check:all` and `npm test` must pass here. The typed client now knows both
routes, so everything below is written against the real thing — no casts, no `any`.

---

## Stage 4 — web types + pure helpers

### 4a. `content-planner/types.ts`

- Add an `ArticleDetailResponse` snake_case type alongside `PlannerKeywordResponse` /
  `CandidateKeywordResponse` — this file already hand-writes API response types even though the
  client is typed; follow that convention.
- Tighten `ArticleEditorDraft` (`:102-116`): `keyword`, `imagesStatus`, `createdAt` become
  required; `updatedAt: string | null`; `publishedAt: string | null`. The optionality only existed
  because mock drafts had no server data.
- Add error unions in the style of the existing `CandidateAddApiError` etc.:
  `ArticleLoadApiError = 'generic' | 'not_found'` and
  `ArticleSaveApiError = 'generic' | 'invalid' | 'not_found' | 'unauthorized'`.

### 4b. New `content-planner/article-editor-utils.ts`

**No `'use client'`** — it must be importable by the node-based vitest run.

- `mapArticleDetail(response): ArticleEditorDraft` — snake→camel.
- `toArticleUpdateBody(draft)` — camel→snake, exactly the five editable fields.
- `getArticleEditorValidation(draft)` — **moved verbatim** from `ArticleEditorModal.tsx:931-960`,
  now importing the constants from `@shared/schemas`.
- `hasEditableArticleChanges(saved, draft)` — **moved verbatim** from `:962-973`.
- `getArticleSaveApiError(status)` — `400→'invalid'`, `401→'unauthorized'`, `404→'not_found'`,
  else `'generic'`. Mirror `getCandidateAddApiError` in `planner-utils.ts`.
- `getServerInvalidFields(body): EditableArticleField[]` — reads the 400 `fields` object and maps
  snake keys to the modal's camelCase field names. Return field names only, **not** the server's
  English messages (they aren't localized; see Stage 8).

Move `EditableArticleField` (`ArticleEditorModal.tsx:20`) here or to `types.ts` so both can use it.

### 4c. Unit tests

`apps/web/tests/article-editor-utils.test.ts`. The root `vitest.config.ts` already globs
`apps/**/tests/**/*.test.ts` — no setup needed. Cover the mapping round-trip, validation boundaries
(meta title 60/61; meta description 119/120/160/161; whitespace-only required fields),
`getArticleSaveApiError` per status, and `getServerInvalidFields` on a valid body and on garbage.

**Do not add jsdom or a component-testing setup.** `apps/web` has none and
[#22](https://github.com/seopotion/seo/issues/22) already tracks adding it. Pure functions only.

---

## Stage 5 — `ArticleEditorModal.tsx`

Precedents to copy — read all three before writing:

1. `content-history/[articleId]/page.tsx:61-87` — a `useQuery` against the **same** endpoint, keyed
   on `dashboardQueryKeys.articleDetail(orgId, articleId)`, with the
   `401 → handleUnauthorized()` / `404 → not-found` / `!ok → throw` ladder. It casts
   `(response.status as number) === 401` because 401 isn't a declared route response — you'll need
   the same cast.
2. `settings/page.tsx:188-230` — the mutation half: `useMutation` + `queryClient.setQueryData` in
   `onSuccess`.
3. `_components/ResearchKeywordsModal.tsx:46-108` — the sibling planner modal takes
   `organizationId` + `onUnauthorized` props and owns its own query/mutation. **Follow this**: the
   editor modal owns its data fetching. Do not lift the query into `page.tsx`.

Changes:

- **Props** (`:34-44`) → `{ article, onClose, organizationId, onUnauthorized, fixturesEnabled }`.
  Drop `onSaveDraft` and `savedDraft`.
- **Query** — place it above the `if (!article) return null` early return at `:144`; hooks can't be
  conditional. Key: `dashboardQueryKeys.articleDetail(organizationId, article?.articleId ?? '')` —
  this key already exists (`apps/web/lib/dashboard-query-keys.ts:31`), don't add a new one.
  `enabled: Boolean(organizationId && article?.articleId)`. Choose `staleTime` deliberately: the
  editor must not render stale content behind a concurrent save, so short/zero here — unlike the
  hour-long staleTimes on planner/settings.
- **Init effect** (`:56-78`) — seed `draftArticle`/`savedArticle` from `articleQuery.data` via
  `mapArticleDetail` when the article key changes or data arrives, and reset server-error state at
  the same time.
- **Delete** `createArticleEditorDraft` (`:975-1004`) and the now-orphaned `slugifyArticleTitle`
  import (`:14`). Check whether `slugifyArticleTitle` (`planner-utils.ts:321`) has any other caller
  — if not, **note it in the PR body as now-dead but do not delete it**. It's pre-existing code and
  CLAUDE.md says clean up only your own mess.
- **Mutation** replacing `saveDraftLocally` (`:114-129`) — `$patch` with
  `toArticleUpdateBody(draft)`; same 401 handling; on 400 read the body and surface field errors;
  `onSuccess` reseeds both `draftArticle` and `savedArticle` from the response (so `updated_at`
  comes from the server), `queryClient.setQueryData` on the detail key, and invalidates
  `dashboardQueryKeys.articleLists(organizationId)` (the content-history list shows title/slug).
  Do **not** invalidate the planner query — planner cards render `article.keyword`, not the article
  title, so nothing there changes; verify that before deciding.
- **Save state** — replace the `savedLocally` boolean (`:53`) with
  `saveState: 'idle' | 'saving' | 'saved' | 'error'`. The header badge block (`:335-345`) branches
  `dirty ? unsaved : savedLocally ? saved : null` — extend for saving/error. Disable Save while
  saving (`:346`).
- **Missing states** — the modal renders **nothing** when there's no draft (`:175-195` → `null`).
  Add loading, not-found, and load-error panels; reuse the small-card shell of
  `PlannedArticleDetails` (`:200-268`) instead of a new layout. The error panel needs a retry.
- **Footer** (`:576-585`) — "saved at" must come from the server:
  `draftArticle.updatedAt ?? draftArticle.createdAt`, one "Last updated {date}" string via the
  existing `formatDateTime`.
- **Server validation** — on 400, mark the returned fields invalid (`EditorField` at `:591` already
  takes `invalid` + `message`) and show one localized banner. Clear server errors when the user
  edits (`updateDraftField`, `:106-112`, already resets adjacent state).

---

## Stage 6 — `page.tsx`

Delete the session-draft cache, now redundant with the react-query cache:
- `articleDraftsById` state (`:59-61`), `selectedSavedDraft` (`:70-72`),
  `handleSaveArticleDraft` (`:82-87`)
- the `setArticleDraftsById({})` line in the org-switch effect (`:119`) — keep the rest of that
  effect; the query key is org-scoped, so the cache partitions by org for free
- the now-unused `ArticleEditorDraft` type import (`:33`)

Update the `<ArticleEditorModal>` call site (`:416-421`) to pass `organizationId`,
`onUnauthorized={handleUnauthorized}`, and `fixturesEnabled`.

---

## Stage 7 — fixtures demo path (dev-only)

So the editor can be clicked through for UI review without seeded Mongo data, extend the existing
mechanism rather than inventing one. `page.tsx:35` gates it with
`PLANNER_FIXTURES_ALLOWED = process.env.NODE_ENV !== 'production'` and `:127-137` reads
`?fixtures=1`.

In `content-planner/fixtures.ts` (currently only `createPlannerFixtureArticles()`), add:
- `createFixtureArticleDetail(articleId): ArticleDetailResponse | null` — real-looking markdown for
  the two fixture entries that have an `articleId`, `null` otherwise (so the not-found panel is
  demoable too).
- A module-level in-memory store + `saveFixtureArticleDetail(id, body): ArticleDetailResponse` that
  applies the patch and stamps a fresh `updated_at`.

In the modal, branch **once** at the top of the `queryFn` and once at the top of the `mutationFn`
on `fixturesEnabled`. Keep it to those two branches — do not thread a fake client through the
component.

This is dev-only scaffolding: keep it small, and don't let it leak into the production path.

---

## Stage 8 — i18n

In **both** `apps/web/messages/en.json` and `apps/web/messages/tr.json`, under
`ContentPlannerPage.editor`:

- **Delete** the whole `mock` block (8 keys: `conclusion`, `conclusionHeading`, `intent`,
  `intentHeading`, `introduction`, `metaDescription`, `structure`, `structureHeading`).
- **Delete** `status.localOnly` — unreachable once every article has a server `created_at`.
- **Reword** off "session draft": `actions.save` ("Save session draft"), `actions.saved`
  ("Session draft saved"), `status.updatedAt` ("Session draft saved {date}").
- **Add** keys for the new states: saving, save error, loading, load error, not found, a
  server-validation banner, and a retry action.

Turkish must be genuinely translated, not left in English — the existing `tr.json` block is fully
translated and sets the bar. Keep both files' key sets identical and ordered as they already are.

Then grep the `editor.*` namespace both ways: no orphaned key, and no `t('editor.…')` call
referencing a deleted one.

---

## Out of scope

- `content-history/[articleId]/page.tsx` — its hand-written `ArticleDetail` type (`:19-30`) is a
  structural subtype of the widened response, so Stage 3 is additive there. Confirm it still
  typechecks; don't refactor it.
- Publishing, AI-assist, image regeneration, or any editor capability not already in the modal.
- Backfilling `updated_at` on existing documents.
- Anything else you notice as broken nearby: mention it, don't fix it.

---

## Verification

```bash
npm run lint            # Biome; lint:fix to format new code
npm run check:all       # backend+shared AND apps/web
npm test
docker compose up -d mongo && npm run test:integration   # if you added repo tests
```

Then **actually run it** — typechecking is not the bar:

```bash
docker compose up -d && npm run dev     # web :3000, api :8787
```

1. `/content-planner?fixtures=1` — open a fixture article, confirm loading → editor → edit → Save →
   "last updated" updates, and that the fixture entry with no `articleId` still opens the read-only
   planned-keyword modal.
2. Against real data (`npm run cli -- db --help` for what's seedable): open a card with a real
   `article_id` and confirm content loads from Mongo, Save persists across a full page reload, an
   unknown id shows the not-found panel, and a too-short meta description is blocked client-side.
3. Force a server 400 (temporarily bypass the client check, or `curl` the endpoint) and confirm the
   `fields` errors render on the right inputs rather than failing silently.

Report exactly what you verified and what you couldn't. If you can't get real article data locally,
say so plainly — do not claim the flow works end to end on the strength of fixtures alone.

---

## Coordination — read before opening the PR

#74 is assigned to `ozykhan` and this PR implements its API. Before you start, check whether there's
an open PR or recent commits against it (`gh pr list --search 74`, `gh issue view 74 --comments`);
if the backend is already in flight, **stop and report** rather than duplicating it.

When you open the PR:
- Comment on #74 with a pointer to the PR, stating plainly that the API contract landed here so
  nobody implements it twice.
- Use `Closes #74` **only if** you genuinely met all of its acceptance criteria (both endpoints,
  auth/ownership, validation contract, and tests covering success / validation failure / not found /
  cross-org). Otherwise `Part of #74` and leave it open.

Branch off `dev` as `alperadoss/<short-description>`, PR into **`dev`** (not `master`); never commit
or merge directly to `dev` or `master`. In the PR body cover: the API contract added, the frontend
wiring, the fixtures demo path, and the notes about `slugifyArticleTitle` and anything else left
dead. Update the article-editor line in `PROGRESS.md` (currently `:49`,
"local/session-draft article editor landed; persisted article editing … remain") — one terse line;
detail belongs in the issue.
