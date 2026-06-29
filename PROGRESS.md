# Progress

Living tracker of what's built vs. what's left. Update as work lands.
Design lives in [`design/`](design/); how-to-work lives in [`CLAUDE.md`](CLAUDE.md).

_Last updated: 2026-06-29 (+ @seo/cli: infra check, db init)_

Legend: ✅ done · 🟡 partial / stubbed · ⬜ not started

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
- ⬜ Editable preset endpoints per category (business / audience / blog / article prefs)
- ⬜ `GET`/`POST /setup/integrations` — publishing-platform connections (design says: hard, defer)
- ⬜ `POST /setup/finalize` — persist + flip status to `setup_complete`
- ⬜ Reconcile FE-generated `org_id` vs Mongo `_id` (open design tension — see design/product-flow.md §1)

## Core / auth

- ✅ Google login → `POST /core/login` (verify Google ID token → upsert user → JWT)
- ✅ `GET /core/organizations` (auth-protected; empty array ⇒ send to setup)
- ✅ `GET /core/status` (auth-protected; the `setup_complete` dashboard gate)
- ✅ Auth middleware (Bearer JWT → `c.var.auth`) + OpenAPI `Bearer` security scheme
- ✅ `/setup/start_scan` now auth-protected and stamps org `user_id`
- 🟡 `JWT_SECRET` / `GOOGLE_CLIENT_ID` are env-driven with dev defaults — set real values per env
- ✅ Logout (clears stored token) — frontend
- ⬜ Token refresh / expiry handling on the client

## Dashboard (mostly INC in design)

- ⬜ Home stats: `/dashboard/v0/articles/{best,published,planned}`, `/dashboard/v0/integrations/connected`
- ⬜ Domain rating + Google Search Console integration
- ⬜ Subscription model (Free/Paid) + Stripe billing + promo codes (design billing with promo codes from the start)
- ⬜ Articles: content planner / history / settings / integrations

## Frontend (`apps/web`)

- ✅ Next.js app wired to the typed client; verified via `next build` (all routes compile/prerender)
- ✅ Google sign-in (Google Identity Services) → `/core/login` → JWT stored (localStorage) → auto-attached on every client call (`getApiClient(url, getToken)`)
- ✅ Auth-gated routing: home shows sign-in; post-login routes by `/core/status` (setup vs dashboard); `/setup` redirects to login without a token; `/dashboard` placeholder
- 🟡 UI is placeholder — needs real onboarding + dashboard screens (mockups in design/product-flow.md)
- 🟡 JWT in localStorage (XSS tradeoff noted in `lib/auth.ts`); no refresh/expiry handling yet
- ⬜ Env: set `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` per env (`.env.example` added)
- ⬜ No component/DOM tests yet (no jsdom env configured); only `tsc` + `next build` cover the UI

## Infrastructure / ops

- 🟡 `infra/lib/api-stack.ts` — API fn, worker fn, SQS queue, HTTP API written but **not synthed/verified** (standalone CDK pkg, not installed here)
- ⬜ `infra/bin` entrypoint so the stack actually `synth`s; verify NodejsFunction bundling end-to-end
- ⬜ Dead-letter queue on `ScanQueue` (failed scans currently just retry/expire)
- ⬜ Run `ensureIndexes()` at deploy (one-off Lambda / custom resource)
- ✅ Linter/formatter: **Biome** (`biome.json`) — `npm run lint` / `lint:fix`
- ✅ CI: `.github/workflows/ci.yml` runs lint + typecheck + tests on push to `main` and all PRs (verified via clean `npm ci`)
- ⬜ Confirm API Gateway stage/base-path stripping vs. Hono mounted paths

## Local development

- ✅ Local API server (`apps/api/src/dev.ts`, `@hono/node-server` via tsx) — `npm run dev -w api`; **verified** (boots, `/health` + OpenAPI respond)
- ✅ Local SQS via ElasticMQ in `docker-compose.yml` + worker poller (`apps/worker/src/dev.ts`); SQS client honors `SQS_ENDPOINT`
- ✅ DB index init script — `npm run db:init`
- ✅ `npm run dev` runs api + worker + web together (concurrently); `.env.example` per app; README "Local full-stack dev" section
- ✅ Management CLI (`apps/cli`, `@seo/cli`, citty + tsx) — `npm run cli -- <cmd>`; commands: `infra check`, `db init`; `--output json` for agents
- 🟡 Worker poller / `db:init` / ElasticMQ are typecheck-verified only here (Docker unavailable in this environment) — run locally to confirm the live round-trip

## Verification gaps (environment-limited)

- ⬜ Integration test not executed here — Docker unavailable. Run: `docker compose up -d mongo && npm run test:integration`
- ⬜ Full SQS round-trip not executed — run locally: `docker compose up -d` then `npm run dev`

## Always-green gates

- `npm run lint` — Biome (lint + format + import-sort)
- `npm run check:all` — typecheck (root + web)
- `npm test` — unit tests (currently 14 passing)
