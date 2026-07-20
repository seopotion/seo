# Progress

Coarse **map** of what's built vs. what's left — by design. Detail for any 🟡/⬜ gap lives in its linked issue (`[#N]`), not here; entries stay to one line so they can't drift from the issue. Design lives in [`design/`](design/); how-to-work in [`CLAUDE.md`](CLAUDE.md).

_Last updated: 2026-07-10 — Frontend onboarding/settings, local-draft article editor, and marketing SEO/perf pass landed. Backend staging remains live (`https://90ukvykb8i.execute-api.us-east-1.amazonaws.com`, `/health` 200); frontend hosting [#35](https://github.com/seopotion/seo/issues/35) remains blocked on SSR answers. Live board: [seo Project](https://github.com/orgs/seopotion/projects/1). Backend → @ozykhan, frontend → @Alperadoss._

Legend: ✅ done · 🟡 partial / stubbed · ⬜ not started. Issue tag/title conventions: [README § Issue tracking](README.md#issue-tracking).

## Foundation (locked & proven)

- ✅ Monorepo (npm workspaces, esbuild at root; Turborepo deferred)
- ✅ TypeScript strict base (bundler resolution, `verbatimModuleSyntax`); Vitest unit + separate integration config
- ✅ Typed Hono RPC client chain (`AppType` → `hc<AppType>`), consumed by `apps/web`
- ✅ Data layer: Zod + `mongodb` driver, repository pattern, module-scoped client
- ✅ Lambda bundling Style A (CDK `NodejsFunction` / esbuild)

## Shared packages

- ✅ `@shared/types`, `@shared/schemas` (Zod entity shapes), `@shared/db` (repos + `ensureIndexes`), `@shared/clients` (typed `getApiClient`), `@shared/providers` (DataForSEO + OpenRouter LLM + fal.ai image clients)

## Setup / onboarding

- 🟡 `start_scan` → SQS → worker → `setup_scan_completed`; schema-valid empty presets persisted until backend real-data scan APIs are connected
- ✅ `GET /setup/status`, `GET /setup/details`, `PATCH /setup/presets`, `POST /setup/finalize`
- ✅ Frontend onboarding wizard calls the typed setup flow (scan → poll → hydrate/save presets → finalize) and redirects by workspace status — [#20](https://github.com/seopotion/seo/issues/20)
- ✅ Identity server-owned (`org_id` = stringified `_id`); `start_scan` idempotent per (user, url)
- 🟡 Onboarding parity backlog — baseline is a deliberate subset; deferred gaps in [`design/onboarding-parity-gaps.md`](design/onboarding-parity-gaps.md) — epic [#8](https://github.com/seopotion/seo/issues/8)
- ⬜ `GET`/`POST /setup/integrations` — publishing-platform connections (deferred) — [#7](https://github.com/seopotion/seo/issues/7)

## Core / auth

- ✅ Google login → `POST /core/login` (verify → upsert → JWT); auth middleware + `Bearer` scheme
- ✅ `GET /core/organizations`, `GET /core/status` (dashboard gate); `start_scan` stamps `user_id`; logout (FE)
- ✅ Real staging `JWT_SECRET` / `GOOGLE_CLIENT_ID` configured — [#9](https://github.com/seopotion/seo/issues/9); prod values deferred — [#43](https://github.com/seopotion/seo/issues/43)
- 🟡 JWT remains in localStorage with no refresh / expiry handling; tracking issue is closed but the code gap remains — [#18](https://github.com/seopotion/seo/issues/18)

## Dashboard (design mapped; build is the frontier)

- ✅ Design fully mapped vs live Outrank — every surface in [`design/product-flow.md`](design/product-flow.md)
- ✅ Home UI (`apps/web/app/dashboard/page.tsx`) — token-gated, renders cards from the typed client
- ✅ Planner, article history (list/detail), Home counts, and supported settings GET/PATCH are real org-scoped typed API reads/writes — [#58](https://github.com/seopotion/seo/issues/58); articles read empty until the generation pipeline ([#56](https://github.com/seopotion/seo/issues/56)) populates them
- 🟡 Home `best`/`integrations` stay mock/empty — gated on GSC ([#12](https://github.com/seopotion/seo/issues/12)) and integrations ([#7](https://github.com/seopotion/seo/issues/7))
- ⬜ Domain Rating + Google Search Console — [#12](https://github.com/seopotion/seo/issues/12)
- ⬜ Subscription (Free/Paid) + Stripe billing + promo codes — [#13](https://github.com/seopotion/seo/issues/13)
- 🟡 Paid keyword research → 30-day plan → scheduled generation/images landed (phases 0–3: [#52](https://github.com/seopotion/seo/issues/52)/[#49](https://github.com/seopotion/seo/issues/49)/[#54](https://github.com/seopotion/seo/issues/54)/[#47](https://github.com/seopotion/seo/issues/47)/[#50](https://github.com/seopotion/seo/issues/50)/[#55](https://github.com/seopotion/seo/issues/55)/[#51](https://github.com/seopotion/seo/issues/51)); only optional auto-publish ([#53](https://github.com/seopotion/seo/issues/53), needs [#7](https://github.com/seopotion/seo/issues/7)) + candidate-pool/publish UI ([#48](https://github.com/seopotion/seo/issues/48)) remain — backend epic [#56](https://github.com/seopotion/seo/issues/56)
- 🟡 Keyword pipeline wired behind a paid-entitlement seam (`Org.plan`/`isPaid`): manual research API `POST /keywords/research` + `/keywords/candidates` ([#50](https://github.com/seopotion/seo/issues/50)) and an automatic 30-day content strategy — paid `/setup/finalize` → SQS strategy queue → strategy worker Lambda runs `@shared/keywords` and cluster-spreads a 30-day planner ([#47](https://github.com/seopotion/seo/issues/47)); library from [#49](https://github.com/seopotion/seo/issues/49)/[#54](https://github.com/seopotion/seo/issues/54). Deployed-env provider secret provisioning still manual/deferred ([#9](https://github.com/seopotion/seo/issues/9)/[#43](https://github.com/seopotion/seo/issues/43))
- ✅ Article generation (#55) — daily EventBridge scheduler fans out due planner entries to an SQS generation worker (`@shared/generation`: outline → article → humanize → deterministic + LLM validation), persists a `generated` article, and atomically links `keyword.article_id`. Cover + inline images [#51](https://github.com/seopotion/seo/issues/51): image SQS task after generation → plan → fal.ai → per-stage S3+CloudFront, idempotent per-slot retries
- ✅ YouTube video embedding — generation worker sources a relevant video (YouTube Data API v3) via LLM pick, injects a nocookie iframe + stores `article.video`; presets toggle `engagement.include_youtube_video` — [#85](https://github.com/seopotion/seo/issues/85). Real `YOUTUBE_API_KEY` provisioning manual ([#9](https://github.com/seopotion/seo/issues/9)/[#43](https://github.com/seopotion/seo/issues/43))
- 🟡 Dashboard UI surfaces — planner/history/settings + local/session-draft article editor landed; persisted article editing, integrations, and candidate-pool UI remain — frontend epic [#19](https://github.com/seopotion/seo/issues/19)

## Frontend (`apps/web`)

- ✅ Next.js on the typed client (verified via `next build`); Google sign-in → JWT (localStorage) → auto-attached; auth/product routing gated by cached `/core/status` with onboarding redirects, bad-auth clear, and retry
- 🟡 Product UI is partially real: onboarding wizard, product guard, planner/history/settings, and local-draft article editor landed; persisted editing/publishing, integrations, and candidate pool remain — [#20](https://github.com/seopotion/seo/issues/20)/[#19](https://github.com/seopotion/seo/issues/19)
- ✅ Marketing landing page SEO/perf pass: JSON-LD, semantic `<main>`, optimized hero image assets/dimensions, and eager/high-priority hero loading — [#20](https://github.com/seopotion/seo/issues/20)
- 🟡 JWT in localStorage; no refresh/expiry — [#18](https://github.com/seopotion/seo/issues/18)
- ⬜ Set `NEXT_PUBLIC_API_URL` + `NEXT_PUBLIC_GOOGLE_CLIENT_ID` per env — [#21](https://github.com/seopotion/seo/issues/21)
- ⬜ No component/DOM tests (no jsdom) — [#22](https://github.com/seopotion/seo/issues/22)

## Infrastructure / ops

- ✅ CDK `ApiStack` — API + worker + db-init Lambdas, SQS queue + DLQ, HTTP API, deploy-time index init; NodejsFunction bundling (ESM `createRequire` banner) verified
- ✅ Parameterized by stage → `SeoApiStack-staging` + `SeoApiStack-prod`; Mongo-URI + JWT resolve at runtime from per-env SSM; backend deploy CI (OIDC — merge `dev`→`master` ships staging; prod via GitHub Release, deferred [#43](https://github.com/seopotion/seo/issues/43)) + `infra/ENVIRONMENTS.md`. Sub-project A [#33](https://github.com/seopotion/seo/issues/33) — **staging deployed** (`CREATE_COMPLETE`, `/health` 200); SQS scan round-trip e2e still to verify
- ✅ First real `cdk deploy` (2026-07-03, single `SeoApiStack`) — now superseded by the two stage stacks; delete manually once staging is healthy — [#15](https://github.com/seopotion/seo/issues/15)
- ✅ `HttpApiUrl` CfnOutput — [#17](https://github.com/seopotion/seo/issues/17); API Gateway `{proxy+}` → Hono `/api/v0/...` live — [#14](https://github.com/seopotion/seo/issues/14)
- ✅ Biome lint/format; CI (`ci.yml`) runs lint + typecheck + tests on PRs
- ✅ Pre-deploy prereq preflight — `infra preflight --stage` CLI verifies SSM secrets + `GOOGLE_CLIENT_ID`; gates the deploy CI — [#16](https://github.com/seopotion/seo/issues/16). Provisioning of the real values is still by hand — [#9](https://github.com/seopotion/seo/issues/9)
- ⬜ `cdk synth` PR-gate for `infra/**` (CI runs root gates only) — [#30](https://github.com/seopotion/seo/issues/30)
- ⬜ Sub-project C — Frontend hosting + previews (OpenNext + CDK); design stub, blocked on SSR answers — [#35](https://github.com/seopotion/seo/issues/35)

## Local development

- ✅ `npm run dev` runs api + worker + web (concurrently); local API server, ElasticMQ SQS, `db:init` — all verified live
- ✅ Management CLI (`apps/cli`, citty) — `npm run cli -- <infra check | db init | db set-plan>`, `--output json` for agents. `db set-plan --org|--user <email> --plan` is a dev/staging paywall escape hatch until Stripe billing lands ([#13](https://github.com/seopotion/seo/issues/13))

## Always-green gates

- `npm run lint` (Biome) · `npm run check:all` (typecheck root + web) · `npm test` (unit) · `npm run test:integration` (needs Mongo)
