# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

TypeScript monorepo (npm workspaces). Hono backend on AWS Lambda behind API Gateway, an SQS-triggered scanner worker, a Next.js frontend, and MongoDB. The headline pattern: the frontend consumes a **typed Hono RPC client inferred from the backend's route types** — zero codegen.

Full design rationale lives in [`design/`](design/) — read it before non-trivial work. Design *plans* go in `design/`, never in this file. Current status and remaining work are tracked in [`PROGRESS.md`](PROGRESS.md) — check it to see what's built vs. stubbed, and update it as you complete work.

## Commands

```bash
npm run lint             # Biome: lint + format check + import-sort (whole repo)
npm run lint:fix         # Biome: apply safe fixes (format, organize imports, safe lint)
npm run check            # typecheck backend + shared packages (tsc, root config)
npm run check:web        # typecheck the Next.js app (its own tsconfig)
npm run check:all        # both
npm test                 # unit tests (Vitest); no infra needed
npm test -- setup        # run a single test file by name filter
npm run test:integration # repository tests vs real Mongo (needs `docker compose up -d mongo`)
npm run dev              # full local stack (api + worker + web) via concurrently
npm run dev -w api       # local Hono HTTP server (Node adapter; serves the Lambda app on :8787)
npm run dev -w worker    # local SQS poller that runs the worker handler
npm run dev -w web       # Next.js dev server
npm run db:init          # create MongoDB indexes (one-off; needs Mongo running)
```

Local full-stack dev needs infra up: `docker compose up -d` (MongoDB :27017 + ElasticMQ SQS :9324) and `.env` files. Shared backend config + secrets live in the **root `.env`** (copy from `.env.example`); the api/worker dev scripts load it first via `--env-file-if-exists=../../.env` then an optional per-app `.env` that overrides it. The web app reads its own `apps/web/.env` (Next.js loader; `NEXT_PUBLIC_*` only — secrets never go here). The API/worker dev entrypoints (`src/dev.ts`, run via `tsx`) serve the same `app`/`handler` as the Lambda build — only the outer adapter differs. The SQS client honors `SQS_ENDPOINT` to target ElasticMQ locally.

Always run `npm run lint`, `npm run check:all`, and `npm test` before claiming work is done.

## Branch workflow

Two-tier flow: `dev` is the integration branch and the **GitHub default base for PRs**;
`master` is the release branch that `dev` is merged into periodically. Despite the git
prelude naming `master`, **PRs target `dev`, not `master`.**

- Never commit or merge directly to `dev` or `master` — always go through a PR.
- Branch off `dev`, named `<gh-name>/<short-description>` (e.g. `ozykhan/backend-stuff`),
  and open the PR into `dev`. Run `npm run lint`, `npm run check:all`, and `npm test`
  before pushing — CI runs the same checks and must pass.
- Only maintainers merge `dev` → `master` (also via PR).
- Branch protection making this mandatory is documented in [README.md](README.md#branch-protection-to-enable-on-github) — enable it there when ready.

## Architecture

### The typed-client chain (most important to understand)

1. Routes are defined with `OpenAPIHono` + `createRoute` and **chained** with `.openapi(...)` so the router type captures every endpoint (`apps/api/src/routes/*`).
2. `apps/api/src/routes/index.ts` mounts routers into `routes` and does `export type AppType = typeof routes`.
3. `packages/shared/clients/src/client.api.ts` does `import type { AppType }` from the api source and wraps `hc<AppType>` — the typed client.
4. `apps/web` imports it (`@shared/clients`) for fully type-checked calls like `api.api.v0.setup.start_scan.$post({ json: {...} })`. Change a route schema and the frontend fails to typecheck.

`API_VERSION` in `apps/api/src/config.ts` is `'v0' as const` — the literal type is what gives the client `client.api.v0.*` autocompletion. Keep it `as const`.

### Auth (Google login + JWT)

Google-only login. The frontend obtains a Google ID token and `POST /core/login` exchanges it for our session JWT: `verifyGoogleIdToken` (`apps/api/src/clients/google.ts`) → `UserRepo.upsertByGoogleSub` → `signToken` (`apps/api/src/auth/jwt.ts`, HS256 via `hono/jwt`). Protected routes declare `security: [{ Bearer: [] }]` + `middleware: [authMiddleware]`; the middleware (`apps/api/src/middlewares/auth.ts`) validates `Authorization: Bearer <jwt>` and sets `c.var.auth = { userId, email }`. Routers that use it are typed `OpenAPIHono<AuthEnv>`. `/core/organizations` (empty array ⇒ send to setup) and `/core/status` (the `setup_complete` gate) are protected, as is `/setup/start_scan` (stamps the new org with `user_id`). Config: `GOOGLE_CLIENT_ID` (public OAuth id) lives in `apps/api/src/config.ts`. The HS256 signing secret is resolved by `getJwtSecret()` (`apps/api/src/auth/secret.ts`): deployed envs set `JWT_SECRET_PARAM` to an SSM SecureString name and the API fetches + caches it via Powertools Parameters (`@aws-lambda-powertools/parameters/ssm`, `maxAge` 1h — at most one SSM call per hour per warm Lambda, never inlined into the CloudFormation template); locally `JWT_SECRET_PARAM` is unset so it falls back to the plain `JWT_SECRET` env var (no AWS needed). CDK references the param by name and grants the API Lambda read only — the worker never gets it.

### Async scan flow (SQS)

`POST /setup/start_scan` creates the org (`setup_scan_in_progress`) and enqueues a scan task to SQS via `apps/api/src/clients/sqs.ts`; the scanner worker (`apps/worker`) consumes it and advances the org to `setup_scan_completed`. The queue message is the shared `ScanTask` Zod schema (`@shared/schemas`) — the API builds it, the worker validates it on read with `ScanTask.parse`. The frontend learns completion by polling `GET /setup/status`, not from the `start_scan` response.

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
