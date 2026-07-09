# AGENTS.md

Compact guide for OpenCode sessions in this TypeScript monorepo. Read `CLAUDE.md`
for full architecture/rationale — this file covers only what an agent would
likely get wrong without it.

## Verify before claiming work is done

Run in this order (CI runs the same):

```bash
npm run lint
npm run check:all     # root tsc + web tsconfig
npm test              # unit tests (Vitest, no infra needed)
```

Single-file test: `npm test -- setup` (filters by name). Integration tests
(`npm run test:integration`) need Mongo up: `docker compose up -d mongo`.

## Monorepo shape

npm workspaces: `packages/shared/*` and `apps/*`. There is **no build step** for
shared packages — they export TS source (`"exports": "./src/index.ts"`) and are
inlined into each Lambda bundle by CDK `NodejsFunction` (esbuild) at synth time.
Internal deps use `"*"` (no `workspace:` protocol).

- `apps/api` — Hono on Lambda behind API Gateway. `src/dev.ts` serves the same
  `app`/`handler` over HTTP (:8787) via `tsx`.
- `apps/worker` — SQS poller; consumes `ScanTask` messages.
- `apps/web` — Next.js; consumes the **typed Hono RPC client**.
- `apps/cli` — `seo-dev` management CLI (citty). Run via `npm run cli -- <cmd>`;
  `--help` lists commands.
- `packages/shared/{db,schemas,clients,logger,types}` — `schemas` (Zod) is the
  single source of truth for entity shapes; `db` owns the cached `MongoClient`
  and repositories; `clients` exports the typed RPC client.
- `infra/` — **standalone** CDK package, not a workspace: `cd infra && npm install`.

## The typed-client chain (do not break it)

Routes use `OpenAPIHono` + `createRoute` chained with `.openapi(...)` in
`apps/api/src/routes/*`. `routes/index.ts` exports `type AppType = typeof routes`.
`packages/shared/clients` wraps `hc<AppType>`. The web app gets fully type-checked
API calls. Changing a route schema breaks web typecheck — that's the signal.

`API_VERSION` in `apps/api/src/config.ts` is `'v0' as const`; the literal drives
`client.api.v0.*` autocompletion. Keep it `as const`.

## Env / dev setup

`docker compose up -d` starts MongoDB (:27017) and ElasticMQ SQS (:9324).
Shared backend secrets live in the **root `.env`** (copy from `.env.example`);
api/worker dev scripts load it via `--env-file-if-exists=../../.env` then a
per-app `.env` override. The web app reads only `apps/web/.env` (`NEXT_PUBLIC_*`
only — never secrets). SQS client honors `SQS_ENDPOINT` (ElasticMQ locally).

One-off index creation: `npm run db:init` (needs Mongo running).

Full stack: `npm run dev` (api + worker + web via `concurrently`).

## Auth & async scan

Google login → `POST /core/login` → JWT (HS256). Protected routes declare
`security: [{ Bearer: [] }]` + `middleware: [authMiddleware]`. Secret resolution:
SSM SecureString in deployed envs, plain `JWT_SECRET` env var locally. **Only
the API Lambda gets the JWT secret, never the worker.**

`POST /setup/start_scan` enqueues a `ScanTask` to SQS; the worker advances org
status. Frontend polls `GET /setup/status` for completion (not the start
response). The message is the shared `ScanTask` Zod schema; worker
`ScanTask.parse`s on read.

## Conventions that differ from defaults

- **Biome**, not ESLint/Prettier: single quotes, 2-space, 100-char, auto
  organize imports. Run `npm run lint:fix` to format.
- `OpenAPIHono` everywhere, never plain `Hono` (feeds types + OpenAPI spec).
- Zod API schemas use `.openapi('Name')`; export both schema and `z.infer` type.
- TS6, zod 4, `@hono/zod-openapi` 1, mongodb 7, Next 16, Vitest 4 — newer than
  older docs assume. No `baseUrl`/`paths` (TS6 deprecated `baseUrl`).
- `verbatimModuleSyntax` is on: use `import type` / `export type`.
- Repositories own `_id` ↔ string `id` mapping and `parse` through Zod at the
  boundary. App code calls repos, never the driver directly. No Mongoose; no
  auto-indexing — `ensureIndexes()` at deploy.
- Tests (Vitest): mock external clients / `@shared/db` with `vi.mock`
  (auto-hoisted above imports); use `vi.hoisted` for spies you assert on. Drive
  HTTP via `testClient<AppType>(app)` or `app.request()`.
- Typed-client auth header goes in the **second** arg:
  `client.api.v0.x.$post({ json }, { headers: { Authorization } })`.
- `hono/jwt` `verify(token, secret, 'HS256')` needs the algorithm arg here.

## Branch workflow

PRs target **`dev`** (not `master`, despite git prelude naming `master`). Branch
off `dev` as `<gh-name>/<short-description>`. Never commit/merge directly to
`dev` or `master`. `master` is the release branch; only maintainers merge
`dev → master` (also via PR). Issue titles use `[area]` prefixes; labels are
`backend`/`infra`/`frontend`/`epic` (`backend` and `infra` are mutually
exclusive). The Project board auto-moves on PR open/merge — don't hand-flip.
`PROGRESS.md` is a coarse built-vs-stubbed map linking to issues; keep entries
to one line + `[#N]`.

## Don't

- No comments unless asked. No speculative abstractions/configurability. Touch
  only what the task requires; don't refactor adjacent code. If you notice
  unrelated dead code, mention it — don't delete it.
- Never commit unless explicitly asked.