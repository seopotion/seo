# Backend environments (staging + prod) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parameterize the CDK `ApiStack` by stage and deploy it as two isolated environments (`SeoApiStack-staging`, `SeoApiStack-prod`), each with its own Mongo cluster, secrets, and HTTP API, deployed by an independent backend CI pipeline.

**Architecture:** One `ApiStack` class takes a `stage` prop and reads per-stage config from a typed map; `bin/app.ts` instantiates it twice. Secrets (Mongo connection string, JWT) are per-env SSM SecureStrings referenced by name and resolved at Lambda runtime — never baked into the CloudFormation template — so CI needs no secret values. This mirrors the existing JWT-secret runtime-resolution pattern (`apps/api/src/auth/secret.ts`).

**Tech Stack:** AWS CDK (`aws-cdk-lib`, TypeScript, standalone `infra/` package), `@aws-lambda-powertools/parameters/ssm`, MongoDB Atlas, GitHub Actions + OIDC, Vitest.

## Global Constraints

- Secrets never enter the CloudFormation template or Lambda env — only SSM parameter **names** are env vars; values resolve at runtime (cached ~1h via Powertools).
- Single AWS account (`personal` / 859998284061 / us-east-1); environments isolated by stack name + separate Mongo clusters + separate secrets.
- `MONGO_URI_PARAM` (SSM name) replaces `MONGO_URI` in deployed Lambda env; local dev/tests keep using the plain `MONGO_URI` env var (default `mongodb://localhost:27017`) — no AWS required.
- The **JWT** secret stays granted to the **API Lambda only**. The **Mongo-URI** secret is granted to **API + worker + db-init** (all three connect to Mongo).
- Use `import type` for type-only imports (`verbatimModuleSyntax`); shared packages export TS source.
- Lint/format with Biome: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` on new code.
- Stage type is exactly `'staging' | 'prod'`.

---

## File Structure

- `packages/shared/db/src/mongo-uri.ts` — **new.** `resolveMongoUri()`: SSM-name path with env-var fallback. One responsibility: produce the connection string.
- `packages/shared/db/src/client.ts` — **modify.** `getDb()` awaits `resolveMongoUri()` instead of reading `process.env.MONGO_URI` inline.
- `packages/shared/db/package.json` — **modify.** Add `@aws-lambda-powertools/parameters` dependency (so the bundler resolves it from `@shared/db`).
- `packages/shared/db/tests/mongo-uri.test.ts` — **new.** Unit tests for both resolution paths.
- `infra/lib/config.ts` — **new.** `Stage` type + `STAGE_CONFIG` map (non-secret values + SSM parameter names).
- `infra/lib/api-stack.ts` — **modify.** `ApiStackProps` with `stage`; resource env wiring reads `STAGE_CONFIG`; grants; `MONGO_URI_PARAM` replaces `MONGO_URI`.
- `infra/bin/app.ts` — **modify.** Instantiate `SeoApiStack-staging` and `SeoApiStack-prod`.
- `.github/workflows/deploy-backend.yml` — **new.** OIDC-auth CDK deploy: `dev`→staging, `master`→prod.
- `infra/ENVIRONMENTS.md` — **new.** Runbook for the out-of-band prerequisites (Atlas clusters, SSM params, OAuth clients, OIDC role).

---

## Task 1: Runtime Mongo-URI resolution in `@shared/db`

**Files:**
- Create: `packages/shared/db/src/mongo-uri.ts`
- Create: `packages/shared/db/tests/mongo-uri.test.ts`
- Modify: `packages/shared/db/src/client.ts`
- Modify: `packages/shared/db/package.json`

**Interfaces:**
- Consumes: `getParameter` from `@aws-lambda-powertools/parameters/ssm`.
- Produces: `export async function resolveMongoUri(): Promise<string>` — used by `getDb()`.

- [ ] **Step 1: Add the Powertools dependency to `@shared/db`**

Edit `packages/shared/db/package.json` `dependencies` (keep alphabetical-ish with existing entries) to add:

```json
    "@aws-lambda-powertools/parameters": "^2.33.1",
```

Then from the repo root install so it resolves in the workspace:

```bash
npm install
```

- [ ] **Step 2: Write the failing test**

Create `packages/shared/db/tests/mongo-uri.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';

const getParameter = vi.hoisted(() => vi.fn());
vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({ getParameter }));

import { resolveMongoUri } from '../src/mongo-uri';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe('resolveMongoUri', () => {
  test('uses the plain MONGO_URI env var when MONGO_URI_PARAM is unset', async () => {
    delete process.env.MONGO_URI_PARAM;
    process.env.MONGO_URI = 'mongodb://localhost:27017';

    await expect(resolveMongoUri()).resolves.toBe('mongodb://localhost:27017');
    expect(getParameter).not.toHaveBeenCalled();
  });

  test('defaults to localhost when neither var is set', async () => {
    delete process.env.MONGO_URI_PARAM;
    delete process.env.MONGO_URI;

    await expect(resolveMongoUri()).resolves.toBe('mongodb://localhost:27017');
  });

  test('fetches the SSM SecureString by name when MONGO_URI_PARAM is set', async () => {
    process.env.MONGO_URI_PARAM = '/seo/prod/mongo-uri';
    getParameter.mockResolvedValue('mongodb+srv://prod-cluster/seo');

    await expect(resolveMongoUri()).resolves.toBe('mongodb+srv://prod-cluster/seo');
    expect(getParameter).toHaveBeenCalledWith('/seo/prod/mongo-uri', {
      decrypt: true,
      maxAge: 3600,
    });
  });

  test('throws when the SSM parameter is missing or empty', async () => {
    process.env.MONGO_URI_PARAM = '/seo/prod/mongo-uri';
    getParameter.mockResolvedValue(undefined);

    await expect(resolveMongoUri()).rejects.toThrow('/seo/prod/mongo-uri');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- mongo-uri`
Expected: FAIL — cannot resolve `../src/mongo-uri` (module does not exist yet).

- [ ] **Step 4: Write the minimal implementation**

Create `packages/shared/db/src/mongo-uri.ts`:

```ts
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';

/**
 * In-process cache TTL for the SSM-backed connection string. Warm Lambdas hit
 * SSM at most once per hour, and the credentials stay out of the template.
 * Mirrors apps/api/src/auth/secret.ts.
 */
const MONGO_URI_MAX_AGE_SECONDS = 3600;

/**
 * Resolves the Mongo connection string.
 *
 * Deployed: `MONGO_URI_PARAM` names an SSM SecureString; fetch + decrypt it via
 * Powertools (cached, see above). Local dev/tests: `MONGO_URI_PARAM` is unset,
 * so fall back to the plain `MONGO_URI` env var (default localhost) — no AWS.
 */
export async function resolveMongoUri(): Promise<string> {
  const param = process.env.MONGO_URI_PARAM;
  if (!param) {
    return process.env.MONGO_URI ?? 'mongodb://localhost:27017';
  }

  const uri = await getParameter(param, {
    decrypt: true,
    maxAge: MONGO_URI_MAX_AGE_SECONDS,
  });
  if (!uri) {
    throw new Error(`SSM parameter ${param} is missing or empty`);
  }
  return uri;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- mongo-uri`
Expected: PASS (4 tests).

- [ ] **Step 6: Wire `getDb()` to use `resolveMongoUri()`**

In `packages/shared/db/src/client.ts`, add the import at the top:

```ts
import { resolveMongoUri } from './mongo-uri';
```

Replace the client-creation line inside `getDb()`. Change:

```ts
export async function getDb(): Promise<Db> {
  if (db) return db;
  client ??= new MongoClient(process.env.MONGO_URI ?? 'mongodb://localhost:27017', {
    maxPoolSize: 5,
    minPoolSize: 0,
  });
  await client.connect(); // no-op if already connected
  db = client.db(process.env.MONGO_DB ?? 'seo');
  return db;
}
```

to:

```ts
export async function getDb(): Promise<Db> {
  if (db) return db;
  if (!client) {
    const uri = await resolveMongoUri();
    client = new MongoClient(uri, { maxPoolSize: 5, minPoolSize: 0 });
  }
  await client.connect(); // no-op if already connected
  db = client.db(process.env.MONGO_DB ?? 'seo');
  return db;
}
```

- [ ] **Step 7: Verify typecheck, lint, and the full unit suite**

Run: `npm run check && npm run lint && npm test`
Expected: all PASS (no `MONGO_URI` reference removed elsewhere; `getDb` still returns a `Db`).

- [ ] **Step 8: Verify integration tests still connect via the env fallback**

Run: `docker compose up -d mongo && npm run test:integration`
Expected: PASS — `MONGO_URI_PARAM` is unset locally, so `resolveMongoUri()` returns `mongodb://localhost:27017` (unchanged behavior).

- [ ] **Step 9: Commit**

```bash
git add packages/shared/db/src/mongo-uri.ts packages/shared/db/tests/mongo-uri.test.ts \
  packages/shared/db/src/client.ts packages/shared/db/package.json package-lock.json
git commit -m "[backend] Resolve Mongo URI from SSM at runtime with env fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Parameterize `ApiStack` by stage

**Files:**
- Create: `infra/lib/config.ts`
- Modify: `infra/lib/api-stack.ts`
- Modify: `infra/bin/app.ts`

**Interfaces:**
- Consumes: `MONGO_URI_PARAM` env contract from Task 1 (Lambdas read the SSM name).
- Produces: `export type Stage = 'staging' | 'prod'`; `export const STAGE_CONFIG: Record<Stage, StageConfig>`; `export interface ApiStackProps extends StackProps { stage: Stage }`. Two synthesizable stacks named `SeoApiStack-staging` / `SeoApiStack-prod`, each emitting a `HttpApiUrl` output.

- [ ] **Step 1: Create the per-stage config map**

Create `infra/lib/config.ts`:

```ts
export type Stage = 'staging' | 'prod';

interface StageConfig {
  mongoDb: string; // logical DB name inside the cluster
  googleClientId: string; // public OAuth client id (per env)
  logLevel: string; // POWERTOOLS_LOG_LEVEL
  jwtSecretParam: string; // SSM SecureString NAME (not value)
  mongoUriParam: string; // SSM SecureString NAME (not value)
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

- [ ] **Step 2: Add the `stage` prop and consume config in `ApiStack`**

In `infra/lib/api-stack.ts`, add imports near the existing ones:

```ts
import { type Stage, STAGE_CONFIG } from './config';
```

Replace the class signature and the top of the constructor. Change:

```ts
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const mongoEnv = {
      MONGO_URI: process.env.MONGO_URI ?? '',
      MONGO_DB: process.env.MONGO_DB ?? 'seo',
      // Powertools Logger level (per-function service name is set in code).
      POWERTOOLS_LOG_LEVEL: process.env.POWERTOOLS_LOG_LEVEL ?? 'INFO',
    };
```

to:

```ts
export interface ApiStackProps extends StackProps {
  stage: Stage;
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const cfg = STAGE_CONFIG[props.stage];

    // Mongo connection string is a SecureString resolved at runtime by
    // @shared/db (see packages/shared/db/src/mongo-uri.ts). Only its NAME is an
    // env var; the value never enters this template.
    const mongoEnv = {
      MONGO_URI_PARAM: cfg.mongoUriParam,
      MONGO_DB: cfg.mongoDb,
      POWERTOOLS_LOG_LEVEL: cfg.logLevel,
    };
```

- [ ] **Step 3: Point the secret references and auth env at the stage config**

In `infra/lib/api-stack.ts`, replace the JWT param + auth env block. Change:

```ts
    const jwtSecretParamName = process.env.JWT_SECRET_PARAM ?? '/seo/jwt-secret';
    const jwtSecretParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'JwtSecretParam',
      { parameterName: jwtSecretParamName },
    );

    // Auth config — read by the API Lambda ONLY. JWT_SECRET_PARAM is just the
    // parameter NAME (not the secret); GOOGLE_CLIENT_ID is a public OAuth id.
    // Deliberately kept out of mongoEnv so the worker never receives them.
    const authEnv = {
      JWT_SECRET_PARAM: jwtSecretParamName,
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? '',
    };
```

to:

```ts
    const jwtSecretParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'JwtSecretParam',
      { parameterName: cfg.jwtSecretParam },
    );

    // Mongo connection string SecureString — read by every Lambda that talks to
    // Mongo (API + worker + db-init). Resolved at runtime, cached ~1h.
    const mongoUriParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'MongoUriParam',
      { parameterName: cfg.mongoUriParam },
    );

    // Auth config — read by the API Lambda ONLY. JWT_SECRET_PARAM is just the
    // parameter NAME (not the secret); GOOGLE_CLIENT_ID is a public OAuth id.
    // Deliberately kept out of mongoEnv so the worker never receives them.
    const authEnv = {
      JWT_SECRET_PARAM: cfg.jwtSecretParam,
      GOOGLE_CLIENT_ID: cfg.googleClientId,
    };
```

- [ ] **Step 4: Grant the Mongo-URI param to the API, worker, and db-init Lambdas**

In `infra/lib/api-stack.ts`, add a `grantRead` after each of the three function definitions.

After `scanQueue.grantSendMessages(apiFn);` and `jwtSecretParam.grantRead(apiFn);`, add:

```ts
    mongoUriParam.grantRead(apiFn);
```

After the worker function's `workerFn.addEventSource(...)` line, add:

```ts
    mongoUriParam.grantRead(workerFn);
```

After the `dbInitFn` definition (before the `dbInitProvider`), add:

```ts
    mongoUriParam.grantRead(dbInitFn);
```

- [ ] **Step 5: Instantiate both stages in `bin/app.ts`**

Replace `infra/bin/app.ts` entirely with:

```ts
#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';

const app = new App();

// Account/region come from the standard CDK env vars when deploying; synth is
// region-agnostic so this is safe to leave undefined.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new ApiStack(app, 'SeoApiStack-staging', { env, stage: 'staging' });
new ApiStack(app, 'SeoApiStack-prod', { env, stage: 'prod' });
```

- [ ] **Step 6: Install infra deps and synth both stacks**

Run:

```bash
cd infra && npm install && npx cdk synth SeoApiStack-staging SeoApiStack-prod > /dev/null && echo SYNTH_OK
```

Expected: prints `SYNTH_OK` (both stacks synthesize without error).

- [ ] **Step 7: Assert secrets are absent and the SSM name is present in the template**

Run (from `infra/`):

```bash
npx cdk synth SeoApiStack-prod | grep -c "MONGO_URI_PARAM" && \
  ! npx cdk synth SeoApiStack-prod | grep -qE '"MONGO_URI":|mongodb\+srv' && echo NO_SECRET_LEAK
```

Expected: prints a count `>= 1` for `MONGO_URI_PARAM`, then `NO_SECRET_LEAK` (no raw `MONGO_URI` key or connection string in the synthesized template).

- [ ] **Step 8: Commit**

```bash
cd .. && git add infra/lib/config.ts infra/lib/api-stack.ts infra/bin/app.ts infra/package-lock.json
git commit -m "[infra] Parameterize ApiStack by stage (staging + prod)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Backend deploy CI + environments runbook

**Files:**
- Create: `.github/workflows/deploy-backend.yml`
- Create: `infra/ENVIRONMENTS.md`

**Interfaces:**
- Consumes: the two stack names from Task 2 (`SeoApiStack-staging`, `SeoApiStack-prod`).
- Produces: a `dev`→staging / `master`→prod deploy pipeline and a documented prerequisites runbook.

- [ ] **Step 1: Write the deploy workflow**

Create `.github/workflows/deploy-backend.yml`:

```yaml
name: Deploy backend

on:
  push:
    branches: [dev, master]
    paths:
      - 'apps/api/**'
      - 'apps/worker/**'
      - 'packages/shared/**'
      - 'scripts/lambda-db-init.ts'
      - 'infra/**'
      - '.github/workflows/deploy-backend.yml'

# One backend deploy per environment at a time.
concurrency:
  group: deploy-backend-${{ github.ref }}
  cancel-in-progress: false

permissions:
  id-token: write # for OIDC
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - name: Resolve stage
        id: stage
        run: |
          if [ "${{ github.ref }}" = "refs/heads/master" ]; then
            echo "name=prod" >> "$GITHUB_OUTPUT"
            echo "stack=SeoApiStack-prod" >> "$GITHUB_OUTPUT"
          else
            echo "name=staging" >> "$GITHUB_OUTPUT"
            echo "stack=SeoApiStack-staging" >> "$GITHUB_OUTPUT"
          fi

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1

      - name: Install infra deps
        run: cd infra && npm ci

      - name: CDK deploy
        env:
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: us-east-1
          GOOGLE_CLIENT_ID_STAGING: ${{ vars.GOOGLE_CLIENT_ID_STAGING }}
          GOOGLE_CLIENT_ID_PROD: ${{ vars.GOOGLE_CLIENT_ID_PROD }}
        run: cd infra && npx cdk deploy ${{ steps.stage.outputs.stack }} --require-approval never
```

- [ ] **Step 2: Validate the workflow YAML parses**

Run:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-backend.yml')); print('YAML_OK')"
```

Expected: prints `YAML_OK`.

- [ ] **Step 3: Write the environments runbook (out-of-band prerequisites)**

Create `infra/ENVIRONMENTS.md`:

```markdown
# Backend environments

Two stacks, one AWS account (`personal` / 859998284061 / us-east-1):

- `SeoApiStack-staging` — deployed on merge to `dev`.
- `SeoApiStack-prod` — deployed on merge to `master`.

Config lives in `infra/lib/config.ts` (non-secret values + SSM parameter NAMES).
Secret values are provisioned out-of-band and resolved at Lambda runtime.

## One-time prerequisites (per account)

1. **Two Atlas clusters** (staging, prod) → two connection strings.
2. **SSM SecureStrings** (values never enter CloudFormation):

   ```sh
   aws ssm put-parameter --name /seo/staging/mongo-uri  --type SecureString --value '<staging-conn-str>'
   aws ssm put-parameter --name /seo/staging/jwt-secret --type SecureString --value '<staging-secret>'
   aws ssm put-parameter --name /seo/prod/mongo-uri     --type SecureString --value '<prod-conn-str>'
   aws ssm put-parameter --name /seo/prod/jwt-secret    --type SecureString --value '<prod-secret>'
   ```

3. **Two Google OAuth client IDs** (staging vs prod). Set them as GitHub Actions
   repo **variables** `GOOGLE_CLIENT_ID_STAGING` and `GOOGLE_CLIENT_ID_PROD`
   (they are public, not secrets). Authorized JavaScript origins are filled in
   during the frontend-hosting sub-project once hostnames exist.
4. **GitHub OIDC provider + deploy role** in the account; store its ARN as the
   `AWS_DEPLOY_ROLE_ARN` secret and the account id as the `AWS_ACCOUNT_ID`
   secret. The role's trust policy must allow this repo's `dev` and `master`
   refs; its permissions must allow `cdk deploy` for the two stacks.

## First deploy

```sh
cd infra && npm ci
CDK_DEFAULT_ACCOUNT=859998284061 CDK_DEFAULT_REGION=us-east-1 \
  npx cdk deploy SeoApiStack-staging
```

## Migration note

The pre-split single `SeoApiStack` (if it was ever deployed) is superseded by
these two. After confirming staging is healthy, remove the old stack manually:
`npx cdk deploy` will not delete it because it is no longer in `bin/app.ts`.
Run `aws cloudformation delete-stack --stack-name SeoApiStack` once you are sure
nothing depends on it.
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-backend.yml infra/ENVIRONMENTS.md
git commit -m "[infra] Backend deploy CI (dev->staging, master->prod) + runbook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (whole sub-project)

- [ ] **Step 1: Full local gate**

Run: `npm run lint && npm run check:all && npm test`
Expected: all PASS.

- [ ] **Step 2: Integration suite via env fallback**

Run: `docker compose up -d mongo && npm run test:integration`
Expected: PASS (unchanged local behavior).

- [ ] **Step 3: Both stacks synth cleanly with no secret leakage**

Run: `cd infra && npx cdk synth SeoApiStack-staging SeoApiStack-prod > /dev/null && echo OK`
Expected: prints `OK`.

- [ ] **Step 4: Manual first staging deploy (requires prerequisites from the runbook)**

Follow `infra/ENVIRONMENTS.md` → deploy `SeoApiStack-staging`. Confirm: the emitted
`HttpApiUrl` responds, a scan round-trips through SQS to `setup_scan_completed`, and
indexes are created on the **staging** cluster only.
```
