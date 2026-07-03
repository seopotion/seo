# Backend environments (staging + prod) — design

_Date: 2026-07-03_

## Context

This is **sub-project A** of a larger effort to host the frontend on AWS and adopt a
three-tier environment model (preview → staging → prod). The larger plan decomposes into:

- **A. Backend environments (this spec)** — parameterize the CDK `ApiStack` by stage and
  deploy it twice (staging + prod), each with its own Mongo cluster, secrets, Google OAuth
  client, and HTTP API. Foundational: the frontend builds point at these API URLs.
- **B. Wishlist → Hono API + Mongo** — relocate the one Next.js route handler
  (`apps/web/app/api/wishlist/route.ts`) into the Hono API and drop Supabase, so the
  frontend can be a pure static export. Small, independent; its own spec/plan.
- **C. Frontend hosting + previews** — static export to S3 + CloudFront for `app.`
  (prod), `app-staging.` (staging), and `*.preview.` (per-PR previews), with CI. Depends
  on A (API URLs) and B (removes the route handler). Its own spec/plan.

This spec covers **A only**. B and C are out of scope here.

## Environment / branch model (the larger plan, for context)

| Tier    | Trigger                | Backend                          | Frontend                     |
| ------- | ---------------------- | -------------------------------- | ---------------------------- |
| Preview | PR into `dev`          | none (uses **staging** API)      | per-PR `*.preview.` (mock data) |
| Staging | merge to `dev`         | `SeoApiStack-staging`            | `app-staging.`               |
| Prod    | merge/release to `master` | `SeoApiStack-prod`            | `app.`                       |

Backend and frontend deploy on **independent CI pipelines** so a frontend change never
waits on a backend release (and vice versa) — this preserves the deliberate
static-frontend / API-over-HTTP decoupling.

## Problem

`infra/lib/api-stack.ts` defines a **single** `ApiStack`, instantiated once in
`infra/bin/*` as `SeoApiStack`. All config is read from `process.env` at `cdk synth` time
and, for `MONGO_URI`, baked into the Lambda environment as plaintext. There is no notion of
a stage, so there is exactly one of everything. To run staging and prod side by side we need
the stack parameterized by stage, with per-stage config and per-stage secrets that never
enter the CloudFormation template.

## Decisions (locked)

- **Single AWS account** (`personal` / 859998284061 / us-east-1). Environments are isolated
  by stack name + separate Mongo clusters + separate secrets, not by account. Account-level
  isolation is a later step if prod ever demands it.
- **Two stacks:** `SeoApiStack-staging` and `SeoApiStack-prod`, from the same `ApiStack`
  class parameterized by a `stage` prop. Stage is part of every stack name.
- **`MONGO_URI` moves to a per-env SSM SecureString**, resolved at **runtime** in
  `@shared/db` — mirroring the existing JWT-secret pattern. Credentials leave the Lambda
  env and the CFN template; CI needs **no secret values** to deploy, only the AWS role.
- **Separate Mongo clusters** for staging and prod (provisioned out-of-band).
- **Generated HTTP API URLs** (emitted as `CfnOutput`) — **defer** custom API domains
  (`api.` / `api-staging.`). YAGNI; addable later without rework.
- **Non-secret config lives in a typed per-stage map in the infra repo**; secrets are
  referenced by SSM name only.

## Design

### 1. Stage prop + double instantiation

Extend the stack props with a required `stage` and thread it through resource naming.

`infra/lib/api-stack.ts`:

```ts
export type Stage = 'staging' | 'prod';

export interface ApiStackProps extends StackProps {
  stage: Stage;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { stage } = props;
    const cfg = STAGE_CONFIG[stage];
    // ...resources below use `stage` / `cfg`...
  }
}
```

`infra/bin/*.ts` — instantiate once per stage:

```ts
const app = new App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new ApiStack(app, 'SeoApiStack-staging', { env, stage: 'staging' });
new ApiStack(app, 'SeoApiStack-prod', { env, stage: 'prod' });
```

Deploy a single stage with `cdk deploy SeoApiStack-staging` (or `-prod`). CI targets one
stack per branch (see §5).

### 2. Per-stage config map (non-secret values only)

A typed config object in the infra package keyed by stage. Holds only **public /
non-sensitive** values. Secret *values* never live here — only the SSM parameter **names**.

`infra/lib/config.ts`:

```ts
import type { Stage } from './api-stack';

interface StageConfig {
  mongoDb: string;                 // e.g. 'seo_staging' / 'seo_prod'
  googleClientId: string;          // public OAuth client id (per env)
  logLevel: string;                // POWERTOOLS_LOG_LEVEL
  jwtSecretParam: string;          // SSM SecureString NAME (not value)
  mongoUriParam: string;           // SSM SecureString NAME (not value)
}

export const STAGE_CONFIG: Record<Stage, StageConfig> = {
  staging: {
    mongoDb: 'seo_staging',
    googleClientId: process.env.GOOGLE_CLIENT_ID_STAGING ?? '',
    logLevel: 'INFO',
    jwtSecretParam: '/seo/staging/jwt-secret',
    mongoUriParam: '/seo/staging/mongo-uri',
  },
  prod: {
    mongoDb: 'seo_prod',
    googleClientId: process.env.GOOGLE_CLIENT_ID_PROD ?? '',
    logLevel: 'INFO',
    jwtSecretParam: '/seo/prod/jwt-secret',
    mongoUriParam: '/seo/prod/mongo-uri',
  },
};
```

Google client IDs are public but env-specific; sourcing them from CI env vars keeps them
out of the committed file while still being non-secret. (They can alternatively be inlined
once the two OAuth clients are created — either is fine since they aren't secrets.)

### 3. Runtime Mongo-URI resolution (the one shared-code change)

Today `@shared/db` reads `process.env.MONGO_URI` directly and the CDK bakes it into each
Lambda's environment. We change the resolution to mirror `apps/api/src/auth/secret.ts`:
fetch a SSM SecureString by name at runtime, cache it (Powertools Parameters, ~1h TTL),
and fall back to the plain `MONGO_URI` env var locally (so local dev / integration tests
need no AWS).

`@shared/db` client (`packages/shared/db/src/client.ts`) resolution order:

1. If `MONGO_URI_PARAM` is set → fetch that SSM SecureString (cached).
2. Else if `MONGO_URI` is set → use it directly (local dev, tests).
3. Else → throw a clear config error.

The connection string is resolved **once** at first `getDb()` and cached at module scope
alongside the existing cached `MongoClient` (Lambda warm-reuse — never connect/close per
handler, per `design/data-layer.md`).

The stacks pass `MONGO_URI_PARAM` (the SSM name) and `MONGO_DB` in the Lambda environment;
they no longer pass `MONGO_URI`. Both the **API and worker** Lambdas need this (the worker
also talks to Mongo), so both get `grantRead` on the Mongo-URI param. This is the one place
this spec deviates from "the worker never receives secrets" — the worker legitimately needs
Mongo, and this pattern is strictly safer than today's plaintext env var. The **JWT** secret
remains API-only, unchanged.

Local `.env` keeps using plain `MONGO_URI` (fallback path) — no local behavior change.

### 4. Per-stage resources & naming

Inside `ApiStack`, everything is derived from `stage` / `cfg`:

- **SSM references by name** (SecureString, out-of-band): `cfg.jwtSecretParam`,
  `cfg.mongoUriParam`. `grantRead`: JWT → API only; Mongo-URI → API + worker + db-init
  (all three connect to Mongo).
- **Lambda environment:**
  - API: `{ MONGO_URI_PARAM: cfg.mongoUriParam, MONGO_DB: cfg.mongoDb,
    POWERTOOLS_LOG_LEVEL: cfg.logLevel, JWT_SECRET_PARAM: cfg.jwtSecretParam,
    GOOGLE_CLIENT_ID: cfg.googleClientId, SCAN_QUEUE_URL }`.
  - Worker: `{ MONGO_URI_PARAM, MONGO_DB, POWERTOOLS_LOG_LEVEL }` — **no** JWT/Google.
  - DB-init: same Mongo trio as the worker.
- **Queues, Lambdas, HTTP API, db-init custom resource:** unchanged in shape; CDK gives
  them stack-scoped logical IDs, so the two stacks never collide. No manual name suffixing
  needed beyond the distinct stack names.
- **`CfnOutput` `HttpApiUrl`** per stack — the value the frontend staging/prod builds will
  consume as `NEXT_PUBLIC_API_URL` (wired in sub-project C).

The bundling config (ESM banner, esbuild monorepo root, `createRequire` shim) is
unchanged — see the `bundling` block and its comment in `infra/lib/api-stack.ts`.

### 5. Backend CI pipeline (independent)

New GitHub Actions workflow, separate from the frontend. Auth via a **GitHub OIDC → IAM
role** (no long-lived keys) scoped to CDK deploy for these stacks.

- `push` to `dev` → `cd infra && npm ci && npx cdk deploy SeoApiStack-staging --require-approval never`.
- `push` to `master` → same for `SeoApiStack-prod`.
- Because Mongo-URI and JWT secrets resolve at runtime from SSM (by name), **synth/deploy
  needs no secret values** — only `CDK_DEFAULT_ACCOUNT`, `CDK_DEFAULT_REGION`, the OIDC
  role, and the (non-secret) per-env `GOOGLE_CLIENT_ID_*` if sourced from CI env.
- Concurrency guard per environment so overlapping merges don't race a deploy.

### 6. Out-of-band prerequisites (provisioned once, by a human)

The spec/plan will document these as manual steps; they are not created by this stack (so
secrets never enter the template):

1. **Two Atlas clusters** (staging, prod) → two connection strings.
2. **Two Mongo-URI SecureStrings:** `/seo/staging/mongo-uri`, `/seo/prod/mongo-uri`.
3. **Two JWT SecureStrings:** `/seo/staging/jwt-secret`, `/seo/prod/jwt-secret`.
4. **Two Google OAuth client IDs** (staging origins vs prod origins). Authorized origins
   filled in during sub-project C once the frontend hostnames exist.
5. **GitHub OIDC provider + deploy role** in the AWS account.

Example (per env):

```sh
aws ssm put-parameter --name /seo/prod/mongo-uri  --type SecureString --value '<conn-str>'
aws ssm put-parameter --name /seo/prod/jwt-secret --type SecureString --value '<secret>'
```

## Out of scope

- The **wishlist migration** (sub-project B) and **frontend hosting/previews**
  (sub-project C).
- **Custom API domains** — deferred; generated HTTP API URLs + `CfnOutput` for now.
- **Separate AWS accounts** per environment — single account by decision.
- Any change to queue/worker/db-init **logic**; only their env wiring and the Mongo-URI
  resolution path change.

## Verification

- `cd infra && npx cdk synth SeoApiStack-staging` and `SeoApiStack-prod` both synth with no
  `MONGO_URI` (or any secret value) present in the template — assert the two Lambda
  environments contain `MONGO_URI_PARAM`, not `MONGO_URI`.
- `npm run check:all` + `npm test` pass (shared `@shared/db` resolution change covered by a
  unit test: SSM-name path vs env-var fallback path).
- `npm run test:integration` still passes via the `MONGO_URI` env fallback (no AWS).
- Manual first deploy of `SeoApiStack-staging`: `/setup/status` reachable at the emitted
  `HttpApiUrl`; a scan round-trips through SQS to `setup_scan_completed`; indexes created on
  the **staging** cluster only.
