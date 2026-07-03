# Progress

Living tracker of what's built vs. what's left. Update as work lands.
Design lives in [`design/`](design/); how-to-work lives in [`CLAUDE.md`](CLAUDE.md).

_Last updated: 2026-07-02 (remaining work now tracked as GitHub issues #7–#22 on the [seo Project board](https://github.com/orgs/seopotion/projects/1); backend → @ozykhan, frontend → @Alperadoss)_

Legend: ✅ done · 🟡 partial / stubbed · ⬜ not started

**Remaining work is tracked as GitHub issues.** Each 🟡/⬜ item below links to its issue (`[#N]`); the [seo Project board](https://github.com/orgs/seopotion/projects/1) is the live kanban. Backend issues are assigned to @ozykhan, frontend to @Alperadoss. Update issues as work lands, then reflect status here. Issue tag + title conventions (the `[area]` prefix and label set) are documented in [README § Issue tracking](README.md#issue-tracking).

## Foundation (architecture decisions — all locked & proven)

- ✅ Monorepo: npm workspaces, no orchestrator yet (Turborepo deferred), esbuild at root
- ✅ TypeScript strict base config (bundler resolution, `verbatimModuleSyntax`)
- ✅ Vitest (unit) + separate integration config
- ✅ Typed Hono RPC client chain (`AppType` → `hc<AppType>`), consumed by `apps/web` — verified by typecheck
- ✅ Data layer: Zod + official `mongodb` driver, repository pattern, module-scoped client
- ✅ Lambda bundling Style A (CDK `NodejsFunction` / esbuild) — wiring written
- ✅ Design docs, `CLAUDE.md`, `README.md`

## Shared packages

- ✅ `@shared/types` — `SETUP_STATUSES` / `SetupStatus`
- ✅ `@shared/schemas` — `OrgSchema` (with `user_id` + optional `presets`) / `CreateOrgInput`, `ScanTask`, `SetupPresetsSchema`, `UserSchema` / `CreateUserInput`
- ✅ `@shared/db` — `getDb`/`closeDb`, `OrgRepo` (create/findById/findByUserId/updateStatus/completeScan), `UserRepo` (findByGoogleSub/upsertByGoogleSub), `ensureIndexes`
- ✅ `@shared/clients` — `getApiClient` (typed)

## Setup / onboarding flow

- ✅ `POST /setup/start_scan` — creates org, enqueues SQS scan task
- ✅ `GET /setup/status` — returns org setup status
- ✅ Scanner worker — consumes SQS, validates `ScanTask`, generates presets, persists them, advances to `setup_scan_completed`
- ✅ `scanWebsite()` — **mock** implementation (deterministic presets derived from the URL); swap for real scrape + AI later
- ✅ Persist generated presets — `SetupPresetsSchema` (business / audience / blog / article prefs) stored on the org via `OrgRepo.completeScan`
- ✅ `GET /setup/details` — returns generated presets (auth-protected, queryable by `org_id`; 404 if org missing or presets not yet generated)
- ✅ `PATCH /setup/presets` — partial edit of generated presets (deep-merge, ownership-checked)
- ⬜ `GET`/`POST /setup/integrations` — publishing-platform connections (design says: hard, defer) — [#7](https://github.com/seopotion/seo/issues/7)
- 🟡 Onboarding parity backlog — baseline is intentionally a subset of a mature flow; deferred gaps (integrations, richer article prefs, Improvements/Product-Catalog subsystems, multi-segment audience, competitor minimums, GSC) captured in [`design/onboarding-parity-gaps.md`](design/onboarding-parity-gaps.md) — epic [#8](https://github.com/seopotion/seo/issues/8)
- ✅ `POST /setup/finalize` — optional final edit + flip status to `setup_complete`
- ✅ Resolved `org_id` vs Mongo `_id` tension: identity is server-owned (`org_id` = stringified `_id`); `start_scan` is idempotent per (user_id, website_url) for non-complete orgs (`OrgRepo.findActiveByUserAndUrl`). Design doc §1 updated.

## Core / auth

- ✅ Google login → `POST /core/login` (verify Google ID token → upsert user → JWT)
- ✅ `GET /core/organizations` (auth-protected; empty array ⇒ send to setup)
- ✅ `GET /core/status` (auth-protected; the `setup_complete` dashboard gate)
- ✅ Auth middleware (Bearer JWT → `c.var.auth`) + OpenAPI `Bearer` security scheme
- ✅ `/setup/start_scan` now auth-protected and stamps org `user_id`
- 🟡 `JWT_SECRET` / `GOOGLE_CLIENT_ID` are env-driven with dev defaults — set real values per env — [#9](https://github.com/seopotion/seo/issues/9)
- ✅ Logout (clears stored token) — frontend
- ⬜ Token refresh / expiry handling on the client — [#18](https://github.com/seopotion/seo/issues/18)

## Dashboard (design fully mapped; build is the frontier)

- ✅ **Dashboard design fully mapped** against live Outrank (2026-07-02) — every surface captured in [`design/product-flow.md`](design/product-flow.md): Home (populated state: published/planned/**awaiting-publish** counts, scored Recommended Actions, GSC-gated Best Articles + Search Performance), Content Planner (per-card affordances: Pre-Create / Add Instructions / Quality Questions ↔ Visit Article), the generated **Article editor** (§2.2.1: `{title, slug, keyword, meta_description, featured_image, content}` + deferred AI-edit layer), Content History table, Articles Settings (Preferences enums + Blog form), General Settings (§2.6: Business + Audience/Competitors), Linking Configuration, Integrations. Improvements Beta / Backlink Exchange / Tools Builder intentionally out of scope.
- 🟡 Home stats: `/api/v0/dashboard/articles/{best,published,planned}`, `/api/v0/dashboard/integrations/connected` — auth-protected routes wired into `AppType`, returning **mock/empty** data (published/planned `0`, best `[]` + `gated:true`, integrations `[]`). Swap handler bodies for real reads later ([#10](https://github.com/seopotion/seo/issues/10)). Tested (`apps/api/tests/dashboard.test.ts`) + verified live. **Design note:** live Home splits articles into three states (published / planned / generated-awaiting-publish) — baseline may want a third count.
- 🟡 Dashboard API skeletons (populated mock data, so FE can build populated states) — auth-protected, wired into `AppType`, tested: `GET /dashboard/planner` (§2.1 scheduled keywords), `GET /dashboard/articles` (§2.2 list, status-filter + limit/offset) + `GET /dashboard/articles/:id` (§2.2.1 full record, 404 on miss), `GET`+`PATCH /dashboard/settings/articles` (§2.3 `article_preferences`) and `GET`+`PATCH /dashboard/settings/general` (§2.6 business + audience/competitors). **Settings GET/PATCH now read/persist real org presets** — org-scoped by `org_id` (query on GET, body on PATCH) with `loadOwnedOrg` ownership→404, deep-merged via `mergePresets` and saved through `OrgRepo.updatePresets` (same pattern as `PATCH /setup/presets`). Planner/articles reads remain mock. Fixtures in `apps/api/src/mocks/dashboard.ts` — the swap-out seam. Settings schemas reuse `SetupPresetsSchema` sub-shapes (single source of truth). Spec: [`docs/superpowers/specs/2026-07-02-dashboard-api-skeletons-design.md`](docs/superpowers/specs/2026-07-02-dashboard-api-skeletons-design.md). **Deferred (not in this batch):** subscription status + `requirePaid` gate, integrations CRUD, keyword mutations (`POST /keywords/research`, `PATCH /keywords/:id`). Real reads + persisting PATCH tracked in [#11](https://github.com/seopotion/seo/issues/11).
- ✅ Dashboard Home UI (`apps/web/app/dashboard/page.tsx`) — token-gated; renders Articles (published/planned), Backlink Exchange (upgrade-gated), Recommended Actions, Best Articles (GSC-gated) cards from the typed client; org domain + Domain Rating badge header
- ⬜ Domain rating + Google Search Console integration — [#12](https://github.com/seopotion/seo/issues/12)
- ⬜ Subscription model (Free/Paid) + Stripe billing + promo codes (design billing with promo codes from the start) — [#13](https://github.com/seopotion/seo/issues/13)
- ⬜ Articles build (design mapped, code not started): content planner / article generation + editor / history / settings / integrations — epic [#19](https://github.com/seopotion/seo/issues/19)

## Frontend (`apps/web`)

- ✅ Next.js app wired to the typed client; verified via `next build` (all routes compile/prerender)
- ✅ Google sign-in (Google Identity Services) → `/core/login` → JWT stored (localStorage) → auto-attached on every client call (`getApiClient(url, getToken)`)
- ✅ Auth-gated routing: home shows sign-in; post-login routes by `/core/status` (setup vs dashboard); `/setup` redirects to login without a token; `/dashboard` placeholder
- 🟡 UI is placeholder — needs real onboarding + dashboard screens (mockups in design/product-flow.md) — [#20](https://github.com/seopotion/seo/issues/20)
- 🟡 JWT in localStorage (XSS tradeoff noted in `lib/auth.ts`); no refresh/expiry handling yet — [#18](https://github.com/seopotion/seo/issues/18)
- ⬜ Env: set `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` per env (`.env.example` added) — [#21](https://github.com/seopotion/seo/issues/21)
- ⬜ No component/DOM tests yet (no jsdom env configured); only `tsc` + `next build` cover the UI — [#22](https://github.com/seopotion/seo/issues/22)

## Infrastructure / ops

- ✅ `infra/lib/api-stack.ts` — API fn, worker fn, SQS queue + DLQ, DB-init custom resource, HTTP API; **`cdk synth` verified green** (standalone CDK pkg)
- ✅ `infra/bin/app.ts` entrypoint + `cdk.json` + `tsconfig.json`; **NodejsFunction bundling verified end-to-end** — both Lambdas bundle (api 1.1M, worker 1.5M, db-init 804K), `@shared/*` inlined, `mongodb`/powertools bundled, `handler` exported. `NodejsFunction` needs `projectRoot`/`depsLockFilePath` at the monorepo root (entries live in `apps/*`)
- ✅ Dead-letter queue on `ScanQueue` (`maxReceiveCount: 3` → `ScanDlq`, 14-day retention)
- ✅ Run `ensureIndexes()` at deploy — `scripts/lambda-db-init.ts` Lambda behind a `Provider`-backed `CustomResource` (re-runs each deploy; indexes idempotent)
- ✅ Linter/formatter: **Biome** (`biome.json`) — `npm run lint` / `lint:fix`
- ✅ CI: `.github/workflows/ci.yml` runs lint + typecheck + tests on push to `main` and all PRs (verified via clean `npm ci`)
- ✅ API Gateway base-path confirmed live — HTTP API `{proxy+}` maps cleanly to Hono's mounted `/api/v0/...` (no stage/base-path stripping needed); `/health` + `/api/v0/openapi.json` return 200 on the deployed endpoint — [#14](https://github.com/seopotion/seo/issues/14)
- ✅ **First real `cdk deploy` done** (2026-07-03, account `859998284061`/`us-east-1`, MongoDB Atlas): `cdk bootstrap` + `cdk deploy` green; DB-init custom resource ran (`ensureIndexes()`); full SQS→worker round-trip verified live (`start_scan` → worker → `setup_scan_completed`, presets persisted + read back via `/setup/details`). **Drift fixed:** ESM bundles need a `createRequire` banner so the mongodb driver's runtime `require('timers/promises')` resolves (`infra/lib/api-stack.ts`) — [#15](https://github.com/seopotion/seo/issues/15)
- ⬜ Pre-deploy prerequisites not yet automated/checked: SSM SecureString `/seo/jwt-secret` must be created out-of-band; `MONGO_URI` / `GOOGLE_CLIENT_ID` are read from `process.env` at **synth** time (CI/deploy must set them, or the Lambdas ship with empty strings) — [#16](https://github.com/seopotion/seo/issues/16)
- ✅ CloudFormation `Output` `HttpApiUrl` (the HTTP API base URL) — deployed endpoint is discoverable for `NEXT_PUBLIC_API_URL`; verified via `cdk synth` — [#17](https://github.com/seopotion/seo/issues/17)

## Local development

- ✅ Local API server (`apps/api/src/dev.ts`, `@hono/node-server` via tsx) — `npm run dev -w api`; **verified** (boots, `/health` + OpenAPI respond)
- ✅ Local SQS via ElasticMQ in `docker-compose.yml` + worker poller (`apps/worker/src/dev.ts`); SQS client honors `SQS_ENDPOINT`
- ✅ DB index init script — `npm run db:init`
- ✅ `npm run dev` runs api + worker + web together (concurrently); `.env.example` per app; README "Local full-stack dev" section
- ✅ Management CLI (`apps/cli`, `@seo/cli`, citty + tsx) — `npm run cli -- <cmd>`; commands: `infra check`, `db init`; `--output json` for agents
- ✅ Worker poller / `db:init` / ElasticMQ verified live (Docker up): `db:init` ensured indexes, worker polled ElasticMQ and processed a real scan message end-to-end

## Verification gaps (environment-limited)

- ✅ Integration tests executed against live Mongo (Docker up) — 3 passed; `npm run db:init` ensured indexes
- ✅ Full SQS round-trip executed against live ElasticMQ + Mongo: `start_scan` → worker consumed → presets persisted → `setup_scan_completed`; `/setup/details` returned presets; dashboard Home endpoints verified live (401 unauth, mock data authed)

## Always-green gates

- `npm run lint` — Biome (lint + format + import-sort)
- `npm run check:all` — typecheck (root + web)
- `npm test` — unit tests (currently 52 passing)
