# SEO DEV

TypeScript monorepo. Hono backend on AWS Lambda (behind API Gateway), a Next.js
frontend, an SQS-triggered scanner worker, and MongoDB. The frontend consumes a
**typed Hono RPC client** inferred from the backend's route types — no codegen.

Design docs live in [`design/`](design/). Start there ([`design/README.md`](design/README.md))
for architecture, the product flow, the API-client pattern, and the data layer.

## Structure

```
apps/
  api/                Hono + Zod OpenAPI backend (Lambda handler)
  worker/             SQS-triggered scanner worker (Lambda)
  web/                Next.js frontend (consumes @shared/clients)
packages/shared/
  types/              @shared/types   — shared TS types (setup state machine)
  schemas/            @shared/schemas — Zod entity schemas (source of truth)
  db/                 @shared/db      — mongodb driver client + repositories
  clients/            @shared/clients — typed Hono RPC client (hc<AppType>)
infra/                AWS CDK (standalone, not a workspace)
```

## Develop

Requires Node 22+. Uses npm workspaces (no Turborepo yet); Lambdas are bundled by
CDK `NodejsFunction` (esbuild) at synth time.

```bash
npm install                 # install all workspaces

npm run lint                # Biome (lint + format + import-sort)
npm run check:all           # typecheck (root + web)
npm test                    # unit tests (Vitest) — no infra needed
```

### Local full-stack dev

Run the whole stack against local MongoDB + a local SQS-compatible queue (ElasticMQ).

```bash
# 1. Infra (MongoDB :27017, SQS :9324, SQS web UI :9325)
docker compose up -d

# 2. Env files (copy and fill in — Google client id is needed for real login)
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env

# 3. Create MongoDB indexes (one-off)
npm run db:init

# 4. Start everything (api :8787, worker poller, web :3000)
npm run dev
#   or individually:
npm run dev -w api          # local Hono HTTP server (Node) — serves the Lambda app
npm run dev -w worker       # long-polls the local SQS queue and runs the handler
npm run dev -w web          # Next.js
```

The API local server (`apps/api/src/dev.ts`) serves the same Hono `app` as the Lambda
handler — only the outer adapter differs. The worker (`apps/worker/src/dev.ts`) polls the
local queue instead of being SQS-triggered. Google sign-in needs a real
`GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` authorized for `http://localhost`.

### Integration tests (real MongoDB)

```bash
docker compose up -d mongo  # MongoDB on :27017
npm run test:integration    # repository round-trips against live Mongo
```

### Infrastructure

```bash
cd infra && npm install && npm run synth   # standalone CDK package
```
