# Progress

Coarse **map** of what's built vs. what's left — by design. Detail for any 🟡/⬜ gap lives in its linked issue (`[#N]`), not here; entries stay to one line so they can't drift from the issue. Design lives in [`design/`](design/); how-to-work in [`CLAUDE.md`](CLAUDE.md).

_Last updated: 2026-07-04 — three-tier env effort: backend-envs sub-project A ([#33](https://github.com/seopotion/seo/issues/33)) implemented (PR #37, pending first staging deploy); frontend-hosting sub-project C ([#35](https://github.com/seopotion/seo/issues/35)) blocked on SSR answers. Live board: [seo Project](https://github.com/orgs/seopotion/projects/1). Backend → @ozykhan, frontend → @Alperadoss._

Legend: ✅ done · 🟡 partial / stubbed · ⬜ not started. Issue tag/title conventions: [README § Issue tracking](README.md#issue-tracking).

## Foundation (locked & proven)

- ✅ Monorepo (npm workspaces, esbuild at root; Turborepo deferred)
- ✅ TypeScript strict base (bundler resolution, `verbatimModuleSyntax`); Vitest unit + separate integration config
- ✅ Typed Hono RPC client chain (`AppType` → `hc<AppType>`), consumed by `apps/web`
- ✅ Data layer: Zod + `mongodb` driver, repository pattern, module-scoped client
- ✅ Lambda bundling Style A (CDK `NodejsFunction` / esbuild)

## Shared packages

- ✅ `@shared/types`, `@shared/schemas` (Zod entity shapes), `@shared/db` (repos + `ensureIndexes`), `@shared/clients` (typed `getApiClient`)

## Setup / onboarding

- ✅ `start_scan` → SQS → worker → `setup_scan_completed`; presets generated (mock `scanWebsite()`) + persisted
- ✅ `GET /setup/status`, `GET /setup/details`, `PATCH /setup/presets`, `POST /setup/finalize`
- ✅ Identity server-owned (`org_id` = stringified `_id`); `start_scan` idempotent per (user, url)
- 🟡 Onboarding parity backlog — baseline is a deliberate subset; deferred gaps in [`design/onboarding-parity-gaps.md`](design/onboarding-parity-gaps.md) — epic [#8](https://github.com/seopotion/seo/issues/8)
- ⬜ `GET`/`POST /setup/integrations` — publishing-platform connections (deferred) — [#7](https://github.com/seopotion/seo/issues/7)

## Core / auth

- ✅ Google login → `POST /core/login` (verify → upsert → JWT); auth middleware + `Bearer` scheme
- ✅ `GET /core/organizations`, `GET /core/status` (dashboard gate); `start_scan` stamps `user_id`; logout (FE)
- 🟡 Real `JWT_SECRET` / `GOOGLE_CLIENT_ID` per env not yet set — [#9](https://github.com/seopotion/seo/issues/9)
- ⬜ Client token refresh / expiry handling — [#18](https://github.com/seopotion/seo/issues/18)

## Dashboard (design mapped; build is the frontier)

- ✅ Design fully mapped vs live Outrank — every surface in [`design/product-flow.md`](design/product-flow.md)
- ✅ Home UI (`apps/web/app/dashboard/page.tsx`) — token-gated, renders cards from the typed client
- 🟡 Home stats endpoints wired into `AppType`, returning mock/empty data — [#10](https://github.com/seopotion/seo/issues/10)
- 🟡 Dashboard API skeletons (planner/articles/settings) — mock reads except settings GET/PATCH (real org presets); swap seam in `apps/api/src/mocks/dashboard.ts` — [#11](https://github.com/seopotion/seo/issues/11)
- ⬜ Domain Rating + Google Search Console — [#12](https://github.com/seopotion/seo/issues/12)
- ⬜ Subscription (Free/Paid) + Stripe billing + promo codes — [#13](https://github.com/seopotion/seo/issues/13)
- ⬜ Articles build (planner / generation + editor / history / settings / integrations) — epic [#19](https://github.com/seopotion/seo/issues/19)

## Frontend (`apps/web`)

- ✅ Next.js on the typed client (verified via `next build`); Google sign-in → JWT (localStorage) → auto-attached; auth-gated routing by `/core/status`
- 🟡 UI is placeholder — needs real onboarding + dashboard screens — [#20](https://github.com/seopotion/seo/issues/20)
- 🟡 JWT in localStorage; no refresh/expiry — [#18](https://github.com/seopotion/seo/issues/18)
- ⬜ Set `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` per env — [#21](https://github.com/seopotion/seo/issues/21)
- ⬜ No component/DOM tests (no jsdom) — [#22](https://github.com/seopotion/seo/issues/22)

## Infrastructure / ops

- ✅ CDK `ApiStack` — API + worker + db-init Lambdas, SQS queue + DLQ, HTTP API, deploy-time index init; NodejsFunction bundling (ESM `createRequire` banner) verified
- ✅ Parameterized by stage → `SeoApiStack-staging` + `SeoApiStack-prod`; Mongo-URI + JWT resolve at runtime from per-env SSM; backend deploy CI (OIDC, `dev`→staging / `master`→prod) + `infra/ENVIRONMENTS.md`. Sub-project A [#33](https://github.com/seopotion/seo/issues/33) (PR #37) — **first staging deploy pending** (human prereqs)
- ✅ First real `cdk deploy` (2026-07-03, single `SeoApiStack`) — now superseded by the two stage stacks; delete manually once staging is healthy — [#15](https://github.com/seopotion/seo/issues/15)
- ✅ `HttpApiUrl` CfnOutput — [#17](https://github.com/seopotion/seo/issues/17); API Gateway `{proxy+}` → Hono `/api/v0/...` live — [#14](https://github.com/seopotion/seo/issues/14)
- ✅ Biome lint/format; CI (`ci.yml`) runs lint + typecheck + tests on PRs
- ✅ Pre-deploy prereq preflight — `infra preflight --stage` CLI verifies SSM secrets + `GOOGLE_CLIENT_ID`; gates the deploy CI — [#16](https://github.com/seopotion/seo/issues/16). Provisioning of the real values is still by hand — [#9](https://github.com/seopotion/seo/issues/9)
- ⬜ `cdk synth` PR-gate for `infra/**` (CI runs root gates only) — [#30](https://github.com/seopotion/seo/issues/30)
- ⬜ Sub-project C — Frontend hosting + previews (OpenNext + CDK); design stub, blocked on SSR answers — [#35](https://github.com/seopotion/seo/issues/35)

## Local development

- ✅ `npm run dev` runs api + worker + web (concurrently); local API server, ElasticMQ SQS, `db:init` — all verified live
- ✅ Management CLI (`apps/cli`, citty) — `npm run cli -- <infra check | db init>`, `--output json` for agents

## Always-green gates

- `npm run lint` (Biome) · `npm run check:all` (typecheck root + web) · `npm test` (unit) · `npm run test:integration` (needs Mongo)
