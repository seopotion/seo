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

npm run check               # typecheck backend + shared packages
npm run check:web           # typecheck the Next.js app
npm run check:all           # both
npm test                    # unit tests (Vitest) — no infra needed
```

### Integration tests (real MongoDB)

```bash
docker compose up -d mongo  # MongoDB on :27017
npm run test:integration    # repository round-trips against live Mongo
```

### Frontend

```bash
npm run dev -w web          # Next.js dev server (set NEXT_PUBLIC_API_URL)
```

### Infrastructure

```bash
cd infra && npm install && npm run synth   # standalone CDK package
```
