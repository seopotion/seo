# Frontend Hosting on AWS via OpenNext — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host `apps/web` on AWS (staging + prod) via OpenNext-built Lambda + CloudFront + S3, deployed by CDK from a new GitHub Actions workflow, replacing the current Vercel deployment.

**Architecture:** `npx @opennextjs/aws build` converts the Next.js build into `.open-next/` output; a new hand-rolled CDK stack (`SeoWebStack-{staging,prod}` in the existing `infra/` package) deploys it as an assets bucket, a server Lambda (runs `proxy.ts` + the 2 OAuth callback routes), an image-optimization Lambda, idle ISR machinery (FIFO revalidation queue + DynamoDB tag table), and a CloudFront distribution. A `deploy-frontend.yml` workflow mirrors `deploy-backend.yml`'s triggers and guards, reusing the same OIDC role.

**Spec:** `docs/superpowers/specs/2026-08-06-frontend-hosting-opennext-design.md` — read it first.

**Tech Stack:** Next.js 16 (webpack production builds), `@opennextjs/aws` ^4.1.0, AWS CDK (TypeScript, `infra/` standalone package), GitHub Actions with OIDC, Vitest.

## Global Constraints

- **This worktree has no `node_modules`.** Before anything else run `npm ci` at the repo root and `cd infra && npm ci`. Without this, typechecks silently resolve `@shared/*` from the main checkout's branch.
- **`next` must resolve to ≥ 16.2.11** (peer-dep floor of `@opennextjs/aws@4.1.0`). Task 1 does the bump; later tasks assume it.
- **Production builds must use webpack, never Turbopack** (`next build --webpack`) — opennextjs-aws issue #1175. `next dev` stays Turbopack.
- **Lockfile trap:** on macOS, npm strips Linux `@emnapi/*` optional deps from `package-lock.json`, breaking CI `npm ci`. After every `npm install`, run `git diff package-lock.json | grep '^-.*@emnapi'` — if it prints anything, restore those hunks (`git checkout HEAD -- package-lock.json`, re-apply the intended dependency change to `package.json` by hand, `npm install --package-lock-only`, re-check) before committing.
- **Style:** Biome — single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after writing code. `infra/` is excluded from root lint but keep the same style (match `api-stack.ts`).
- **Commits:** `[web]` / `[infra]` / `[ci]` prefix per area, message body explains why. Never commit to `dev`/`master` — all work stays on this branch (`claude/issue-35-deployment-options-2a7227`), PR into `dev`.
- **Before claiming done:** `npm run lint`, `npm run check:all`, `npm test` must all pass.

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/web/package.json` | next ≥16.2.11, webpack build script, `@opennextjs/aws` devDep |
| `apps/web/app/robots.ts` | noindex switch for non-prod builds |
| `apps/web/tests/robots.test.ts` | unit tests for the switch |
| `apps/web/open-next.config.ts` | OpenNext build config (buildCommand) |
| `infra/lib/config.ts` | + `WEB_STAGE_CONFIG` (domains per stage) |
| `infra/lib/web-stack.ts` | the whole WebStack (bucket, 4 Lambdas, queue, table, CDN, cert) |
| `infra/bin/app.ts` | instantiate web stacks (guarded on `.open-next` existing) |
| `.github/workflows/deploy-frontend.yml` | staging + prod deploy jobs |
| `infra/ENVIRONMENTS.md` | frontend section: variables, role policy, runbook |
| `PROGRESS.md` | one status line for #35 |

---

### Task 1: Bump Next to ≥ 16.2.11 and switch production builds to webpack

**Files:**
- Modify: `apps/web/package.json` (deps + `build` script)
- Modify: `package-lock.json` (via npm)

**Interfaces:**
- Consumes: nothing.
- Produces: `next@16.3.x` resolved in the lockfile; `npm run build -w web` runs `next build --webpack`. Task 3's OpenNext build depends on both.

- [ ] **Step 1: Install deps in the worktree** (global constraint)

Run: `npm ci && cd infra && npm ci && cd ..`
Expected: clean install, no errors.

- [ ] **Step 2: Bump next**

Run: `npm install next@^16.3.0 -w web`
Then verify: `grep -A1 '"node_modules/next"' package-lock.json | head -2`
Expected: `"version": "16.3.x"` (any version ≥ 16.2.11).

- [ ] **Step 3: Check the lockfile for the @emnapi prune**

Run: `git diff package-lock.json | grep '^-.*@emnapi' || echo LOCKFILE-OK`
Expected: `LOCKFILE-OK`. If @emnapi lines were removed, follow the Global Constraints remedy before continuing.

- [ ] **Step 4: Switch the build script to webpack**

In `apps/web/package.json` change:

```json
"build": "next build --webpack",
```

(was `"build": "next build"`; leave `predev`/`prebuild`/`dev`/`start` untouched).

- [ ] **Step 5: Verify the webpack build works**

Run: `NEXT_PUBLIC_SITE_URL=https://staging.seopotion.co npm run build -w web`
Expected: build succeeds; output should NOT mention Turbopack (Next prints the bundler in use). If `--webpack` is rejected as an unknown flag, run `npx next build --help` inside `apps/web` and use the flag it documents for opting out of Turbopack — the requirement is a webpack build, the flag spelling is the only variable. Requires the `zip` CLI on PATH (the `prebuild` step packages the WP plugin).

- [ ] **Step 6: Typecheck + tests still pass**

Run: `npm run check:all && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json package-lock.json
git commit -m "[web] Bump next to 16.3 and build with webpack

@opennextjs/aws@4 requires next >=16.2.11, and its Turbopack builds hit
opennextjs-aws#1175 (missing 404/error chunks). Part of #35"
```

---

### Task 2: `robots.ts` noindex switch (TDD)

**Files:**
- Test: `apps/web/tests/robots.test.ts` (create)
- Modify: `apps/web/app/robots.ts`

**Interfaces:**
- Consumes: existing `apps/web/app/robots.ts` default export (Next `MetadataRoute.Robots`).
- Produces: builds with `NEXT_PUBLIC_NOINDEX=1` emit a disallow-all `robots.txt`. Task 5's staging job sets that variable.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/robots.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from '../app/robots';

describe('robots', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('disallows everything when NEXT_PUBLIC_NOINDEX is set', () => {
    vi.stubEnv('NEXT_PUBLIC_NOINDEX', '1');
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
  });

  it('allows the public tree by default', () => {
    const result = robots();
    expect(result.rules).toMatchObject({ userAgent: '*', allow: '/' });
    expect(result.sitemap).toContain('/sitemap.xml');
  });
});
```

- [ ] **Step 2: Run it — must fail**

Run: `npm test -- robots`
Expected: FAIL — the noindex case gets the allow-all shape.

- [ ] **Step 3: Implement**

In `apps/web/app/robots.ts`, add at the top of the default export (before the existing `return`):

```ts
  // Non-prod builds (staging) must never be indexed — the deploy workflow sets
  // NEXT_PUBLIC_NOINDEX=1 there. Metadata routes are prerendered, so this is
  // resolved at build time.
  if (process.env.NEXT_PUBLIC_NOINDEX === '1') {
    return {
      rules: { userAgent: '*', disallow: '/' },
      host: SITE_URL,
    };
  }
```

- [ ] **Step 4: Run tests — must pass**

Run: `npm test -- robots`
Expected: PASS (both cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:fix
git add apps/web/app/robots.ts apps/web/tests/robots.test.ts
git commit -m "[web] robots.ts: disallow all when NEXT_PUBLIC_NOINDEX is set

Staging deploys must not be indexed (#35)."
```

---

### Task 3: OpenNext build tooling

**Files:**
- Modify: `apps/web/package.json` (devDep)
- Create: `apps/web/open-next.config.ts`
- Modify: `.gitignore` (root)

**Interfaces:**
- Consumes: Task 1 (next ≥16.2.11, webpack build).
- Produces: `cd apps/web && npx @opennextjs/aws build` yields `.open-next/` with `assets/`, `cache/`, `server-functions/default/`, `image-optimization-function/`, `revalidation-function/`, `dynamodb-provider/`. Task 4's CDK reads these paths. Also produces the **server handler path** (recorded in Step 4) that Task 4's `SERVER_HANDLER` constant needs.

- [ ] **Step 1: Add the dependency**

Run: `npm install -D @opennextjs/aws@^4.1.0 -w web`
Then the lockfile check: `git diff package-lock.json | grep '^-.*@emnapi' || echo LOCKFILE-OK` → `LOCKFILE-OK`.

- [ ] **Step 2: Create `apps/web/open-next.config.ts`**

```ts
import type { OpenNextConfig } from '@opennextjs/aws/types/open-next.js';

// Default AWS config: server + image functions, S3 incremental cache, SQS
// revalidation queue, DynamoDB tag cache — all provisioned by
// infra/lib/web-stack.ts. buildCommand keeps `prebuild` (WP-plugin zip) running.
const config = {
  default: {},
  buildCommand: 'npm run build',
} satisfies OpenNextConfig;

export default config;
```

(If the type import path 404s at typecheck, find the current one with `ls apps/web/node_modules/@opennextjs/aws/types/` — the shape `{ default: {}, buildCommand }` is the stable part.)

- [ ] **Step 3: Ignore the build output**

Add to the root `.gitignore` (near the existing build-output entries):

```
apps/web/.open-next/
```

- [ ] **Step 4: Smoke-build and record the handler path**

Run:

```bash
cd apps/web && NEXT_PUBLIC_SITE_URL=https://staging.seopotion.co npx @opennextjs/aws build
ls .open-next
find .open-next/server-functions/default -maxdepth 3 -name 'index.mjs'
```

Expected: `.open-next` contains `assets`, `cache`, `server-functions`, `image-optimization-function`, `revalidation-function`, `dynamodb-provider`. **Record where `index.mjs` sits** relative to `server-functions/default/`:
- at the top level → Task 4's `SERVER_HANDLER = 'index.handler'`
- nested (monorepo layout), e.g. `apps/web/index.mjs` → `SERVER_HANDLER = 'apps/web/index.handler'`

- [ ] **Step 5: Typecheck + commit**

Run: `npm run check:all` → PASS (config file is typechecked by the web tsconfig).

```bash
git add apps/web/package.json apps/web/open-next.config.ts .gitignore package-lock.json
git commit -m "[web] Add @opennextjs/aws build tooling

npx @opennextjs/aws build produces .open-next/ for the CDK web stack (#35)."
```

---

### Task 4: The WebStack (CDK)

**Files:**
- Modify: `infra/lib/config.ts` (append `WEB_STAGE_CONFIG`)
- Create: `infra/lib/web-stack.ts`
- Modify: `infra/bin/app.ts`

**Interfaces:**
- Consumes: `.open-next/` layout + `SERVER_HANDLER` value from Task 3; `Stage` type from `infra/lib/config.ts`.
- Produces: stacks `SeoWebStack-staging` / `SeoWebStack-prod` with CfnOutputs `DistributionDomain`, `DistributionId`, `TagSeedFunctionName`, `WebBucketName` — Task 5's workflow consumes the outputs via `--outputs-file`.

- [ ] **Step 1: Append to `infra/lib/config.ts`**

```ts
// ---------------------------------------------------------------------------
// Frontend (SeoWebStack) — #35. First domainNames entry is the certificate
// primary and canonical host; the rest are SANs.
export interface WebStageConfig {
  domainNames: string[];
  apexRedirect?: { from: string; to: string };
}

export const WEB_STAGE_CONFIG: Record<Stage, WebStageConfig> = {
  staging: { domainNames: ['staging.seopotion.co'] },
  prod: {
    domainNames: ['www.seopotion.co', 'seopotion.co'],
    apexRedirect: { from: 'seopotion.co', to: 'www.seopotion.co' },
  },
};
```

- [ ] **Step 2: Create `infra/lib/web-stack.ts`**

```ts
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AllowedMethods,
  type BehaviorOptions,
  CacheCookieBehavior,
  CacheHeaderBehavior,
  CachePolicy,
  CacheQueryStringBehavior,
  Distribution,
  Function as CfFunction,
  FunctionCode,
  FunctionEventType,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin, S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { AttributeType, BillingMode, ProjectionType, Table } from 'aws-cdk-lib/aws-dynamodb';
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  FunctionUrlAuthType,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { IHostedZone } from 'aws-cdk-lib/aws-route53';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { BucketDeployment, CacheControl, Source } from 'aws-cdk-lib/aws-s3-deployment';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';
import { type Stage, WEB_STAGE_CONFIG } from './config';

// OpenNext build output — `npx @opennextjs/aws build` must run in apps/web
// before this stack synthesizes (bin/app.ts skips the web stacks otherwise).
export const OPEN_NEXT_DIR = join(__dirname, '../../apps/web/.open-next');

// Where index.mjs sits inside server-functions/default — monorepo builds nest
// it under the workspace path. Set from Task 3's smoke build:
//   top-level index.mjs        -> 'index.handler'
//   apps/web/index.mjs nested  -> 'apps/web/index.handler'
const SERVER_HANDLER = 'index.handler';

interface WebStackProps extends StackProps {
  stage: Stage;
  // DNS lives on Cloudflare today, so this stays undefined and cert validation
  // is manual. If the domain ever moves to Route 53, pass the zone and both
  // validation and alias records become CDK-managed (spec § Domains & DNS).
  hostedZone?: IHostedZone;
}

export class WebStack extends Stack {
  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);
    const config = WEB_STAGE_CONFIG[props.stage];
    const isProd = props.stage === 'prod';

    // --- Assets + incremental cache bucket -------------------------------
    const bucket = new Bucket(this, 'WebBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      autoDeleteObjects: !isProd,
    });

    // Hashed build assets are content-addressed — cache forever. prune:false
    // keeps prior deploys' chunks alive for HTML still cached at the edge.
    new BucketDeployment(this, 'HashedAssets', {
      destinationBucket: bucket,
      destinationKeyPrefix: '_assets',
      sources: [Source.asset(join(OPEN_NEXT_DIR, 'assets'), { exclude: ['*', '!_next/**'] })],
      prune: false,
      cacheControl: [CacheControl.fromString('public,max-age=31536000,immutable')],
    });
    new BucketDeployment(this, 'PublicAssets', {
      destinationBucket: bucket,
      destinationKeyPrefix: '_assets',
      sources: [Source.asset(join(OPEN_NEXT_DIR, 'assets'), { exclude: ['_next/**'] })],
      prune: false,
      cacheControl: [CacheControl.fromString('public,max-age=0,s-maxage=31536000,must-revalidate')],
    });
    new BucketDeployment(this, 'IncrementalCache', {
      destinationBucket: bucket,
      destinationKeyPrefix: '_cache',
      sources: [Source.asset(join(OPEN_NEXT_DIR, 'cache'))],
      prune: false,
    });

    // --- ISR machinery (provisioned, idle today — spec § Architecture) ---
    const revalidationQueue = new Queue(this, 'RevalidationQueue', {
      fifo: true,
      contentBasedDeduplication: true,
      receiveMessageWaitTime: Duration.seconds(20),
    });

    const tagCacheTable = new Table(this, 'TagCacheTable', {
      partitionKey: { name: 'tag', type: AttributeType.STRING },
      sortKey: { name: 'path', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: isProd ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });
    tagCacheTable.addGlobalSecondaryIndex({
      indexName: 'revalidate',
      partitionKey: { name: 'path', type: AttributeType.STRING },
      sortKey: { name: 'revalidatedAt', type: AttributeType.NUMBER },
      projectionType: ProjectionType.ALL,
    });

    // --- Functions -------------------------------------------------------
    const serverFn = new LambdaFunction(this, 'ServerFn', {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      code: Code.fromAsset(join(OPEN_NEXT_DIR, 'server-functions/default')),
      handler: SERVER_HANDLER,
      memorySize: 1024,
      timeout: Duration.seconds(30),
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        CACHE_BUCKET_NAME: bucket.bucketName,
        CACHE_BUCKET_REGION: this.region,
        CACHE_BUCKET_KEY_PREFIX: '_cache',
        REVALIDATION_QUEUE_URL: revalidationQueue.queueUrl,
        REVALIDATION_QUEUE_REGION: this.region,
        CACHE_DYNAMO_TABLE: tagCacheTable.tableName,
      },
    });
    bucket.grantReadWrite(serverFn);
    revalidationQueue.grantSendMessages(serverFn);
    tagCacheTable.grantReadWriteData(serverFn);
    const serverUrl = serverFn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

    const imageFn = new LambdaFunction(this, 'ImageFn', {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      code: Code.fromAsset(join(OPEN_NEXT_DIR, 'image-optimization-function')),
      handler: 'index.handler',
      memorySize: 1536,
      timeout: Duration.seconds(25),
      logRetention: RetentionDays.ONE_WEEK,
      environment: { BUCKET_NAME: bucket.bucketName, BUCKET_KEY_PREFIX: '_assets' },
    });
    bucket.grantRead(imageFn);
    const imageUrl = imageFn.addFunctionUrl({ authType: FunctionUrlAuthType.NONE });

    const revalidationFn = new LambdaFunction(this, 'RevalidationFn', {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      code: Code.fromAsset(join(OPEN_NEXT_DIR, 'revalidation-function')),
      handler: 'index.handler',
      memorySize: 128,
      timeout: Duration.seconds(30),
      logRetention: RetentionDays.ONE_WEEK,
    });
    revalidationFn.addEventSource(new SqsEventSource(revalidationQueue, { batchSize: 5 }));

    // Seeds the tag table from the build's dynamodb-cache.json. Deliberately
    // NOT a CloudFormation custom resource — the deploy workflow invokes it
    // directly after `cdk deploy` (payload in deploy-frontend.yml).
    const tagSeedFn = new LambdaFunction(this, 'TagSeedFn', {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      code: Code.fromAsset(join(OPEN_NEXT_DIR, 'dynamodb-provider')),
      handler: 'index.handler',
      memorySize: 256,
      timeout: Duration.minutes(2),
      logRetention: RetentionDays.ONE_WEEK,
      environment: {
        CACHE_DYNAMO_TABLE: tagCacheTable.tableName,
        CACHE_BUCKET_REGION: this.region,
      },
    });
    tagCacheTable.grantReadWriteData(tagSeedFn);

    // --- Certificate (manual DNS validation — Cloudflare) ----------------
    const certificate = new Certificate(this, 'WebCert', {
      domainName: config.domainNames[0],
      subjectAlternativeNames: config.domainNames.slice(1),
      // Without a hosted zone the FIRST deploy pauses on this resource until
      // the validation CNAMEs (ACM console) are added in Cloudflare. Expected.
      validation: props.hostedZone
        ? CertificateValidation.fromDns(props.hostedZone)
        : CertificateValidation.fromDns(),
    });

    // --- CloudFront ------------------------------------------------------
    // OpenNext reads the real host from x-forwarded-host (the Host header is
    // the function URL's own domain by the time it reaches Lambda). Prod also
    // 301s the apex to www here.
    const apexRedirect = config.apexRedirect
      ? `  if (request.headers.host.value === '${config.apexRedirect.from}') {
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: 'https://${config.apexRedirect.to}' + request.uri } },
    };
  }
`
      : '';
    const viewerRequestFn = new CfFunction(this, 'ViewerRequestFn', {
      code: FunctionCode.fromInline(`function handler(event) {
  var request = event.request;
${apexRedirect}  request.headers['x-forwarded-host'] = { value: request.headers.host.value };
  return request;
}`),
    });

    const serverCachePolicy = new CachePolicy(this, 'ServerCachePolicy', {
      queryStringBehavior: CacheQueryStringBehavior.all(),
      headerBehavior: CacheHeaderBehavior.allowList(
        'accept',
        'rsc',
        'next-router-prefetch',
        'next-router-state-tree',
        'next-url',
      ),
      cookieBehavior: CacheCookieBehavior.none(),
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });
    const imageCachePolicy = new CachePolicy(this, 'ImageCachePolicy', {
      queryStringBehavior: CacheQueryStringBehavior.all(),
      headerBehavior: CacheHeaderBehavior.allowList('accept'),
      cookieBehavior: CacheCookieBehavior.none(),
      defaultTtl: Duration.days(1),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.days(365),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const assetsOrigin = S3BucketOrigin.withOriginAccessControl(bucket, {
      originPath: '/_assets',
    });
    const staticBehavior: BehaviorOptions = {
      origin: assetsOrigin,
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_OPTIMIZED,
    };

    // _next/image* must precede the derived _next/* behavior (insertion order
    // is CloudFront precedence). Everything in .open-next/assets gets a static
    // behavior — public/ files (integrations/, downloads/, *.png) included.
    const additionalBehaviors: Record<string, BehaviorOptions> = {
      '_next/image*': {
        origin: new FunctionUrlOrigin(imageUrl),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: imageCachePolicy,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    };
    for (const entry of readdirSync(join(OPEN_NEXT_DIR, 'assets'), { withFileTypes: true })) {
      const pattern = entry.isDirectory() ? `${entry.name}/*` : entry.name;
      additionalBehaviors[pattern] = staticBehavior;
    }

    const distribution = new Distribution(this, 'WebCdn', {
      domainNames: config.domainNames,
      certificate,
      defaultBehavior: {
        origin: new FunctionUrlOrigin(serverUrl),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        cachePolicy: serverCachePolicy,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        functionAssociations: [
          { function: viewerRequestFn, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      },
      additionalBehaviors,
    });

    new CfnOutput(this, 'DistributionDomain', {
      value: distribution.distributionDomainName,
      description: 'Point the Cloudflare CNAMEs here (DNS-only / grey cloud)',
    });
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId });
    new CfnOutput(this, 'TagSeedFunctionName', {
      value: tagSeedFn.functionName,
      description: 'Invoked by deploy-frontend.yml after each deploy',
    });
    new CfnOutput(this, 'WebBucketName', { value: bucket.bucketName });
  }
}

export function openNextBuildExists(): boolean {
  return existsSync(OPEN_NEXT_DIR);
}
```

Set `SERVER_HANDLER` per Task 3 Step 4's finding.

- [ ] **Step 3: Instantiate in `infra/bin/app.ts`**

Append after the ApiStack instantiations:

```ts
// Web stacks synthesize only when the OpenNext build output exists — backend
// deploy jobs never build the frontend, and Code.fromAsset would throw on the
// missing directory otherwise (#35).
if (openNextBuildExists()) {
  new WebStack(app, 'SeoWebStack-staging', { env, stage: 'staging' });
  new WebStack(app, 'SeoWebStack-prod', { env, stage: 'prod', terminationProtection: true });
} else {
  console.warn(
    'apps/web/.open-next not found — SeoWebStack-* skipped. Run `npx @opennextjs/aws build` in apps/web first.',
  );
}
```

And add the import at the top: `import { openNextBuildExists, WebStack } from '../lib/web-stack';`

- [ ] **Step 4: Synth both ways**

Run (from `infra/`, with `.open-next` present from Task 3):

```bash
npx cdk synth SeoWebStack-staging --quiet && echo SYNTH-OK
```

Expected: `SYNTH-OK` (template synthesizes; cert + distribution + 4 functions present).

Then verify the guard: `mv ../apps/web/.open-next /tmp/on-backup && npx cdk synth SeoApiStack-staging --quiet > /dev/null && echo GUARD-OK; mv /tmp/on-backup ../apps/web/.open-next`
Expected: the skip warning prints, then `GUARD-OK` — backend synth is not broken by a missing web build.

- [ ] **Step 5: Commit**

```bash
git add infra/lib/web-stack.ts infra/lib/config.ts infra/bin/app.ts
git commit -m "[infra] Add SeoWebStack: OpenNext frontend on CloudFront+Lambda+S3

Hand-rolled over .open-next output per the spec (constructs rejected there).
ISR queue+tag table provisioned idle; cert validation manual (Cloudflare DNS).
Part of #35"
```

---

### Task 5: `deploy-frontend.yml`

**Files:**
- Create: `.github/workflows/deploy-frontend.yml`

**Interfaces:**
- Consumes: Task 4's stack names + outputs (`TagSeedFunctionName`, `DistributionId`); repo variables `NEXT_PUBLIC_API_URL_STAGING/PROD` (new — Task 6 documents them), `WEB_ORIGIN_*`, `GOOGLE_CLIENT_ID_*`; secrets `AWS_DEPLOY_ROLE_ARN`, `AWS_ACCOUNT_ID`.
- Produces: staging deploy on `master` push, prod deploy on Release — same guard structure as `deploy-backend.yml`.

- [ ] **Step 1: Create the workflow**

```yaml
name: Deploy frontend

# Mirrors deploy-backend.yml: merging `dev` → `master` deploys staging; a
# published GitHub Release deploys prod after the same two guards (commit on
# master + this workflow's own successful staging run for that commit). #35.
on:
  push:
    branches: [master]
    paths:
      - 'apps/web/**'
      - 'packages/**'
      - 'apps/integration-clients/wordpress-org/**'
      - 'scripts/package-wp-plugin.mjs'
      - 'infra/lib/web-stack.ts'
      - 'infra/lib/config.ts'
      - 'infra/bin/app.ts'
      - '.github/workflows/deploy-frontend.yml'
  release:
    types: [published]

permissions:
  id-token: write # for OIDC
  contents: read

jobs:
  deploy-staging:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    concurrency:
      group: deploy-frontend-staging
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1

      - name: Install root deps
        run: npm ci

      - name: OpenNext build (staging)
        # NEXT_PUBLIC_* are build-time inlined — every env needs its own build.
        env:
          NEXT_PUBLIC_API_URL: ${{ vars.NEXT_PUBLIC_API_URL_STAGING }}
          NEXT_PUBLIC_SITE_URL: ${{ vars.WEB_ORIGIN_STAGING }}
          NEXT_PUBLIC_GOOGLE_CLIENT_ID: ${{ vars.GOOGLE_CLIENT_ID_STAGING }}
          NEXT_PUBLIC_NOINDEX: '1'
        run: cd apps/web && npx @opennextjs/aws build

      - name: Install infra deps
        run: cd infra && npm ci

      - name: CDK deploy
        env:
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: us-east-1
        run: >
          cd infra && npx cdk deploy SeoWebStack-staging
          --require-approval never --outputs-file outputs.json

      - name: Seed tag cache
        run: |
          fn=$(jq -r '.["SeoWebStack-staging"].TagSeedFunctionName' infra/outputs.json)
          aws lambda invoke --function-name "$fn" \
            --cli-binary-format raw-in-base64-out \
            --payload '{"type":"initializationFunction","requestType":"create","resourceId":"dynamodb-cache"}' \
            /dev/null

      - name: Invalidate CloudFront
        # SSG HTML carries a long s-maxage — without this, deploys don't show.
        run: |
          dist=$(jq -r '.["SeoWebStack-staging"].DistributionId' infra/outputs.json)
          aws cloudfront create-invalidation --distribution-id "$dist" --paths '/*'

  deploy-prod:
    # Prereleases are for testing a tag, not for shipping — they must not deploy.
    if: github.event_name == 'release' && !github.event.release.prerelease
    runs-on: ubuntu-latest
    # Declared for the OIDC subject (repo:seopotion/seo:environment:prod), same
    # as deploy-backend.yml — no protection rules exist on the environment.
    environment: prod
    permissions:
      id-token: write # for OIDC
      contents: read
      actions: read # read this workflow's own run history
    concurrency:
      group: deploy-frontend-prod
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
        with:
          # Full history so the ancestry check below can see master.
          fetch-depth: 0

      - name: Verify the release commit is on master
        env:
          # Through env, never `${{ }}` inline — tag names are attacker-shaped
          # (see deploy-backend.yml for the full rationale).
          RELEASE_TAG: ${{ github.event.release.tag_name }}
        run: |
          git fetch --no-tags --quiet origin master
          if ! git merge-base --is-ancestor "$GITHUB_SHA" origin/master; then
            echo "::error::Release $RELEASE_TAG points at $GITHUB_SHA, which is not an ancestor of master. Cut releases from master so prod ships staging-verified code."
            exit 1
          fi
          echo "$GITHUB_SHA is on master — proceeding."

      - name: Verify staging deployed this commit successfully
        env:
          GH_TOKEN: ${{ github.token }}
          RELEASE_TAG: ${{ github.event.release.tag_name }}
        run: |
          run_id=$(gh run list \
            --repo "$GITHUB_REPOSITORY" \
            --workflow deploy-frontend.yml \
            --event push \
            --commit "$GITHUB_SHA" \
            --status success \
            --limit 1 \
            --json databaseId \
            --jq '.[0].databaseId // empty')
          if [ -z "$run_id" ]; then
            echo "::error::No successful staging deploy of deploy-frontend.yml exists for $GITHUB_SHA. Release $RELEASE_TAG would ship a frontend staging has not verified."
            exit 1
          fi
          echo "Staging deploy run $run_id succeeded for $GITHUB_SHA — proceeding."

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: package-lock.json

      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_DEPLOY_ROLE_ARN }}
          aws-region: us-east-1

      - name: Install root deps
        run: npm ci

      - name: OpenNext build (prod)
        env:
          NEXT_PUBLIC_API_URL: ${{ vars.NEXT_PUBLIC_API_URL_PROD }}
          NEXT_PUBLIC_SITE_URL: ${{ vars.WEB_ORIGIN_PROD }}
          NEXT_PUBLIC_GOOGLE_CLIENT_ID: ${{ vars.GOOGLE_CLIENT_ID_PROD }}
        run: cd apps/web && npx @opennextjs/aws build

      - name: Install infra deps
        run: cd infra && npm ci

      - name: CDK deploy
        env:
          CDK_DEFAULT_ACCOUNT: ${{ secrets.AWS_ACCOUNT_ID }}
          CDK_DEFAULT_REGION: us-east-1
        run: >
          cd infra && npx cdk deploy SeoWebStack-prod
          --require-approval never --outputs-file outputs.json

      - name: Seed tag cache
        run: |
          fn=$(jq -r '.["SeoWebStack-prod"].TagSeedFunctionName' infra/outputs.json)
          aws lambda invoke --function-name "$fn" \
            --cli-binary-format raw-in-base64-out \
            --payload '{"type":"initializationFunction","requestType":"create","resourceId":"dynamodb-cache"}' \
            /dev/null

      - name: Invalidate CloudFront
        run: |
          dist=$(jq -r '.["SeoWebStack-prod"].DistributionId' infra/outputs.json)
          aws cloudfront create-invalidation --distribution-id "$dist" --paths '/*'
```

- [ ] **Step 2: Dry-run the staging job's script locally**

The workflow can't run until it's on `master`, so prove its command sequence works here (AWS steps excluded):

```bash
cd apps/web && NEXT_PUBLIC_NOINDEX=1 NEXT_PUBLIC_SITE_URL=https://staging.seopotion.co npx @opennextjs/aws build && cd ../../infra && npx cdk synth SeoWebStack-staging --quiet && echo DRY-RUN-OK
```

Expected: `DRY-RUN-OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-frontend.yml
git commit -m "[ci] Add deploy-frontend workflow (staging on master, prod on Release)

Same OIDC role and prod guards as deploy-backend.yml. Part of #35"
```

---

### Task 6: Documentation

**Files:**
- Modify: `infra/ENVIRONMENTS.md`
- Modify: `PROGRESS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: the owner's runbook for first deploys and cutover.

- [ ] **Step 1: Add a "Frontend (SeoWebStack)" section to `infra/ENVIRONMENTS.md`**

Place it after the backend deploy sections, following the file's existing tone. It must contain, concretely:

1. **Stacks:** `SeoWebStack-staging` → `https://staging.seopotion.co`, `SeoWebStack-prod` → `https://www.seopotion.co` (+ apex 301). Deployed by `deploy-frontend.yml` with the same triggers/guards as the backend.
2. **New repo variables:** `NEXT_PUBLIC_API_URL_STAGING` / `NEXT_PUBLIC_API_URL_PROD` (the `HttpApiUrl` output of the corresponding ApiStack). Note that `WEB_ORIGIN_STAGING/PROD` now also feed the web build's `NEXT_PUBLIC_SITE_URL` and must be set to `https://staging.seopotion.co` / `https://www.seopotion.co` — changing them requires **one backend redeploy** per stage (they're baked into the API Lambda at synth time for CORS + the GSC OAuth redirect base).
3. **Deploy-role policy addition** (one-time, needed because the workflow invokes the seed Lambda and creates invalidations):

```bash
aws iam put-role-policy --role-name github-actions-seo-deploy \
  --policy-name frontend-deploy \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      { "Effect": "Allow", "Action": "lambda:InvokeFunction",
        "Resource": "arn:aws:lambda:us-east-1:'"$AWS_ACCOUNT_ID"':function:SeoWebStack-*" },
      { "Effect": "Allow", "Action": "cloudfront:CreateInvalidation",
        "Resource": "arn:aws:cloudfront::'"$AWS_ACCOUNT_ID"':distribution/*" }
    ]
  }'
```

4. **First-deploy runbook:** the first `cdk deploy` of each web stack **pauses** at the certificate until the ACM validation CNAMEs (ACM console → the pending cert) are added in Cloudflare as DNS-only records. Then: add the site CNAMEs (`staging`, `www`, apex — all DNS-only/grey-cloud, target = the stack's `DistributionDomain` output; Cloudflare flattens the apex CNAME automatically), and register `https://staging.seopotion.co` as an authorized JavaScript origin in the Google OAuth console.
5. **Cutover checklist** (copy from the spec § Verification): staging smoke (locale routing, `_next/image` resizing, docs MDX, staging robots.txt disallow-all, sitemap/canonicals point at staging host, Google login + both OAuth callbacks, 404/error pages), then flip the prod DNS records, re-run the same checks against `www.seopotion.co` plus the apex redirect, then delete the Vercel project.

- [ ] **Step 2: Add the `PROGRESS.md` line**

In the frontend/infra area of the map, add exactly one line (keep it terse — detail lives in the issue):

```markdown
- Frontend hosting on AWS (OpenNext + CDK): stacks + deploy workflow implemented; first deploy, DNS records, and Vercel retirement pending [#35]
```

- [ ] **Step 3: Commit**

```bash
git add infra/ENVIRONMENTS.md PROGRESS.md
git commit -m "[infra] Document frontend deploys: variables, role policy, cutover runbook

Part of #35"
```

---

### Task 7: Final verification + PR

**Files:** none new.

- [ ] **Step 1: Full check suite**

Run: `npm run lint && npm run check:all && npm test`
Expected: all PASS. (`npm run lint` must be clean on the changed files; `lint:fix` anything it flags.)

- [ ] **Step 2: Lockfile sanity**

Run: `git diff origin/dev -- package-lock.json | grep '^-.*@emnapi' || echo LOCKFILE-OK`
Expected: `LOCKFILE-OK`.

- [ ] **Step 3: Push and open the PR into `dev`**

```bash
git push -u origin claude/issue-35-deployment-options-2a7227
gh pr create --base dev \
  --title "[infra] Frontend hosting on AWS via OpenNext (staging + prod)" \
  --body "$(cat <<'EOF'
Implements the approved spec `docs/superpowers/specs/2026-08-06-frontend-hosting-opennext-design.md`.

- next bumped to 16.3 (OpenNext peer-dep floor 16.2.11); production builds use webpack (opennextjs-aws#1175)
- `robots.ts` disallows all when `NEXT_PUBLIC_NOINDEX=1` (staging builds set it)
- `@opennextjs/aws` build tooling + `open-next.config.ts`
- `SeoWebStack-{staging,prod}`: assets bucket, server/image/revalidation/tag-seed Lambdas, idle ISR queue + tag table, CloudFront with ACM cert (manual Cloudflare validation), apex→www redirect on prod
- `deploy-frontend.yml`: staging on master push, prod on Release with the same guards as the backend; reuses the existing OIDC role
- `infra/ENVIRONMENTS.md` runbook: new repo variables, one-time role-policy addition, first-deploy cert pause, DNS + Google OAuth steps, cutover checklist

**Not closed by this PR** — remaining owner steps before #35 is done: set the new repo variables, apply the role-policy addition, first deploys (cert validation), Cloudflare DNS records, Google OAuth origin, staging smoke, prod DNS flip, Vercel retirement.

Part of #35

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `dev`; CI (`ci.yml` verify job) goes green.
