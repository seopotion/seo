# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TypeScript monorepo (npm workspaces). Four apps: Hono backend on AWS Lambda behind API Gateway (`apps/api`), an SQS-triggered scanner worker (`apps/worker`), a Next.js frontend (`apps/web`), and a management CLI (`apps/cli`); plus MongoDB. The headline pattern: the frontend consumes a **typed Hono RPC client inferred from the backend's route types** — zero codegen.

Full design rationale lives in [`design/`](design/) — read it before non-trivial work. Design *plans* go in `design/`, never in this file. Current status and remaining work are tracked in [`PROGRESS.md`](PROGRESS.md) — check it to see what's built vs. stubbed, and update it as you complete work.

## Communication

Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of the response on the main answer. When asked to explain something, give a high-level summary unless an in-depth explanation is specifically requested.

## Coding Principles

### 1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.
- The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"

For multi-step tasks, state a brief plan with clear verification steps.

## Commands

Command names live in `package.json` (root + per-app). What isn't obvious from there:

- `npm run check:all` — typecheck backend + shared (root `tsc`) **and** the web app (its own tsconfig); `check` / `check:web` run each half.
- `npm test -- setup` — run a single test file by name filter (`test` needs no infra).
- `npm run test:integration` — repository tests vs real Mongo; needs `docker compose up -d mongo`.
- `npm run dev` — full stack via `concurrently`; `-w api` serves the Lambda app over HTTP on :8787 (Node adapter), `-w worker` is the SQS poller, `-w web` is Next.js.
- `npm run db:init` — one-off MongoDB index creation; needs Mongo running.
- `npm run cli -- <infra|db|articles> …` — `seo-dev` management CLI (`apps/cli`, citty), built for humans **and agents**: `infra` runs local-infra checks, `db` handles database management, `articles` operates the article pipeline (inspect, trigger generation, republish). `npm run cli -- --help` lists commands. With `--output json`, run it as `npm run --silent cli -- …`: npm prints its `> pkg@ver script` banner to **stdout**, which corrupts the JSON payload (the CLI warns on stderr when it detects this).

Always run `npm run lint`, `npm run check:all`, and `npm test` before claiming work is done.

Local full-stack dev needs infra up: `docker compose up -d` (MongoDB :27017 + ElasticMQ SQS :9324) and `.env` files. Shared backend config + secrets live in the **root `.env`** (copy from `.env.example`); the api/worker dev scripts load it first via `--env-file-if-exists=../../.env` then an optional per-app `.env` that overrides it. The web app reads its own `apps/web/.env` (Next.js loader; `NEXT_PUBLIC_*` only — secrets never go here). The API/worker dev entrypoints (`src/dev.ts`, run via `tsx`) serve the same `app`/`handler` as the Lambda build — only the outer adapter differs. The SQS client honors `SQS_ENDPOINT` to target ElasticMQ locally.

## Branch workflow

Three-tier flow mapped to environments. `dev` is the integration branch and the
**GitHub default base for PRs** — merging to `dev` **deploys nothing**. `master` is the
**staging** branch: merging `dev`→`master` deploys `SeoApiStack-staging`. **Production**
deploys `SeoApiStack-prod` when a **GitHub Release is published** — no approval step
(the plan doesn't support required reviewers), so publishing ships prod immediately;
the job refuses a release whose commit is not on `master` or has no successful
staging deploy run of its own. Despite the git prelude naming `master`, **PRs target
`dev`, not `master`.**

| Branch / event           | Deploys       |
| ------------------------ | ------------- |
| push to `dev`            | nothing       |
| merge `dev` → `master`   | **staging**   |
| GitHub Release published | **prod** (immediately) |

- Never commit or merge directly to `dev` or `master` — always go through a PR.
- Branch off `dev`, named `<gh-name>/<short-description>` (e.g. `ozykhan/backend-stuff`),
  and open the PR into `dev`. Run the checks above before pushing — CI runs the same
  checks and must pass.
- Only maintainers merge `dev` → `master` (also via PR) — that's what ships **staging**.
- Prod ships by publishing a GitHub Release from a `master` commit that staging
  already deployed successfully — see
  [`infra/ENVIRONMENTS.md`](infra/ENVIRONMENTS.md#deploying-prod). Provisioning the prod
  environment's secrets is tracked in [#43](https://github.com/seopotion/seo/issues/43).

When filing or triaging issues, follow the tag conventions in [README.md § Issue tracking](README.md#issue-tracking): every title gets an `[area]` prefix, and `backend`/`infra`/`frontend`/`epic` are the labels (`backend` and `infra` are mutually exclusive — code vs. ops).

### Issue & board workflow

Agent sessions start cold, so the durable trail (git, PR bodies, issue comments, [`PROGRESS.md`](PROGRESS.md), memory) is how the next session gets a warm start — that's the point of this bookkeeping, not process for its own sake. Keep it proportional: a typo fix needs none of this; a tracked feature gets the full loop.

- **Start:** find the linked issue and read it for scope. Don't hand-flip board columns — the [Project board](https://github.com/orgs/seopotion/projects/1) auto-moves cards on PR open/merge. Only move a card manually when concurrent workers actually need the signal.
- **During:** reference the issue in commits / PR body (`Part of #N`).
- **Finish:** the **PR body** holds the detail and carries `Closes #N` for anything *fully* done, so the merge closes it. Comment on an issue only when its status *meaningfully* changed, and keep it a concise pointer to the PR — not a play-by-play. **Don't close issues by hand mid-session**; let merge do it, and leave issues open when a real remainder survives (e.g. a human-gated deploy).
- **Source of truth (one fact, one owner):** issues (+ the board as their live view) hold task state, acceptance criteria, and discussion. `PROGRESS.md` is a coarse built-vs-stubbed **map that links to issues, never restates them** — one line + `[#N]` per gap, so there's nothing to drift. PR body is one change's record. Agent memory is machine-local and **must not duplicate the repo** (pointers to issues/PRs only, pruned when stale). Update `PROGRESS.md` when work lands, but keep entries terse — detail belongs in the issue, not here.

## Architecture

### The typed-client chain (most important to understand)

1. Routes are defined with `OpenAPIHono` + `createRoute` and **chained** with `.openapi(...)` so the router type captures every endpoint (`apps/api/src/routes/*`).
2. `apps/api/src/routes/index.ts` mounts routers into `routes` and does `export type AppType = typeof routes`.
3. `packages/shared/clients/src/client.api.ts` does `import type { AppType }` from the api source and wraps `hc<AppType>` — the typed client.
4. `apps/web` imports it (`@shared/clients`) for fully type-checked calls like `api.api.v0.setup.start_scan.$post({ json: {...} })`. Change a route schema and the frontend fails to typecheck.

`API_VERSION` in `apps/api/src/config.ts` is `'v0' as const` — the literal type is what gives the client `client.api.v0.*` autocompletion. Keep it `as const`.

### Auth (Google login + JWT)

Google-only login. `POST /core/login` exchanges a Google ID token for our session JWT: `verifyGoogleIdToken` (`clients/google.ts`) → `UserRepo.upsertByGoogleSub` → `signToken` (`auth/jwt.ts`, HS256 via `hono/jwt`). Protected routes declare `security: [{ Bearer: [] }]` + `middleware: [authMiddleware]` and are typed `OpenAPIHono<AuthEnv>`; the middleware (`middlewares/auth.ts`) validates `Authorization: Bearer <jwt>` and sets `c.var.auth = { userId, email }`. Protected today: `/core/organizations` (empty ⇒ send to setup), `/core/status` (the `setup_complete` gate), `/setup/start_scan` (stamps the org with `user_id`).

The HS256 signing secret is resolved by `getJwtSecret()` (`auth/secret.ts`): deployed envs read an SSM SecureString named by `JWT_SECRET_PARAM` (fetched + cached ~1h via Powertools); locally it falls back to the plain `JWT_SECRET` env var (no AWS needed). **Only the API Lambda is granted the secret — never the worker.** `GOOGLE_CLIENT_ID` (public OAuth id) lives in `config.ts`.

### Async scan flow (SQS)

`POST /setup/start_scan` creates the org (`setup_scan_in_progress`) and enqueues a scan task to SQS via `apps/api/src/clients/sqs.ts`; the scanner worker (`apps/worker`) consumes it and advances the org to `setup_scan_completed`. The queue message is the shared `ScanTask` Zod schema (`@shared/schemas`) — the API builds it, the worker validates it on read with `ScanTask.parse`. The frontend learns completion by polling `GET /setup/status`, not from the `start_scan` response.

The strategy job (30-day content plan) has a different shape: it's a Step Functions state machine over Mongo-checkpointed `strategy_runs` docs, launched by `@shared/strategy`'s `launchStrategy` — no SQS queue.

### Data layer (Zod + official mongodb driver, no Mongoose)

- `@shared/schemas` (Zod) is the single source of truth for entity shapes; API request/response schemas in `apps/api/src/schemas/` derive from / reuse them.
- `@shared/db` holds the `MongoClient` (cached at module scope for Lambda warm-reuse — never connect/close in a handler) and per-collection repositories. Repositories own `_id` ↔ string `id` mapping and `parse` through Zod at the boundary. App code calls repositories, never the driver directly.
- Indexes are created explicitly via `ensureIndexes()` at deploy time — the driver has no Mongoose-style auto-indexing.

### Deployment

Lambdas are bundled by CDK `NodejsFunction` (esbuild) at synth time — "Style A". `@shared/*` is TS source, inlined into each bundle; there is no per-app build step. `infra/` is a **standalone** CDK package (not a workspace) — `cd infra && npm install` separately.

## Conventions

- `OpenAPIHono` everywhere, never plain `Hono`, so every route feeds both the type and the OpenAPI spec (`/api/v0/openapi.json`, Swagger UI at `/api/v0/ui`).
- Zod API schemas use `.openapi('Name')`; export both the schema and its `z.infer` type.
- Shared packages export TS source (`exports: { ".": "./src/index.ts" }`); internal deps use `"*"` (npm has no `workspace:` protocol).
- Tests (Vitest): mock external clients/`@shared/db` with `vi.mock` (auto-hoisted above imports); use `vi.hoisted` for spies you assert on. Drive HTTP via `testClient<AppType>(app)` and `app.request()`.
- The web app's `tsconfig` is a superset (includes `node` types) because importing `AppType` pulls the backend graph into its compile — see [design/monorepo-and-api-client.md](design/monorepo-and-api-client.md).
- Linting/formatting is **Biome** (`biome.json`): single quotes, 2-space indent, 100-char width, auto-organized imports. Generated files (`.next/`, `next-env.d.ts`, `dist/`, `cdk.out/`) are excluded. Run `npm run lint:fix` to format new code.

## Gotchas

- `tsconfig.base.json` targets bundler resolution with `verbatimModuleSyntax` — use `import type` for type-only imports, and `export type` when re-exporting types from another package.
- Versions in use are newer than older docs assume: TypeScript 6, zod 4, `@hono/zod-openapi` 1, mongodb 7, Next 16, Vitest 4. `baseUrl`/`paths` are intentionally absent (TS6 deprecated `baseUrl`; workspaces resolve `@shared/*` via `node_modules`).
- Sending an auth header via the typed client uses the **second** `ClientRequestOptions` arg, not the schema args: `client.api.v0.x.$post({ json }, { headers: { Authorization: ... } })`. Putting `header` in the first arg only works if the route declares a request `headers` schema.
- `hono/jwt` `verify(token, secret, 'HS256')` requires the algorithm argument in this version (2 args won't compile).
