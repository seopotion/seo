import { join } from 'node:path';
import {
  CfnOutput,
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { CachePolicy, Distribution, ViewerProtocolPolicy } from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Provider } from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';
import { STAGE_CONFIG, type Stage } from './config';

/**
 * API stack — Style A bundling: `NodejsFunction` runs esbuild at `cdk synth`
 * time, resolving the @shared/* TS source straight into one bundle per Lambda.
 * No separate app build step. See design/monorepo-and-api-client.md.
 *
 * Flow: POST /setup/start_scan -> SQS scan queue -> scanner worker Lambda.
 *
 * NOTE: this package is standalone (not in the npm workspaces). Install with
 * `cd infra && npm install` before `cdk synth`. esbuild must be resolvable from
 * the repo root for monorepo NodejsFunction bundling.
 */
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

    // JWT signing secret lives in an SSM SecureString created out-of-band (so
    // the secret never enters this template). We reference it by NAME and grant
    // the API Lambda read; the API fetches + caches it at runtime via Powertools
    // Parameters. See apps/api/src/auth/secret.ts.
    //   aws ssm put-parameter --name /seo/<stage>/jwt-secret --type SecureString --value <secret>
    const jwtSecretParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'JwtSecretParam',
      { parameterName: cfg.jwtSecretParam },
    );

    // GSC secrets (#12): OAuth client secret + refresh-token encryption key.
    // Same out-of-band SecureString pattern as the JWT secret:
    //   aws ssm put-parameter --name /seo/<stage>/google-client-secret --type SecureString --value <secret>
    //   aws ssm put-parameter --name /seo/<stage>/gsc-token-key --type SecureString --value "$(openssl rand -base64 32)"
    const googleClientSecretParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'GoogleClientSecretParam',
      { parameterName: cfg.googleClientSecretParam },
    );
    const gscTokenKeyParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'GscTokenKeyParam',
      { parameterName: cfg.gscTokenKeyParam },
    );

    // GitHub App private key (#7): the PKCS#1 PEM GitHub issues once at
    // registration, minting per-publish installation tokens. Same out-of-band
    // SecureString pattern — `file://` so the PEM's newlines survive:
    //   aws ssm put-parameter --name /seo/<stage>/github-app-key --type SecureString --value file://seopotion.<stage>.private-key.pem
    // API Lambda only, matching the JWT-secret boundary: the worker never
    // publishes, so it is never granted a credential that can write to a
    // customer's repository.
    const githubAppKeyParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'GithubAppKeyParam',
      { parameterName: cfg.githubAppKeyParam },
    );

    // LemonSqueezy billing secrets (#13): API key (checkout/portal calls) +
    // webhook signing secret. Same out-of-band SecureString pattern:
    //   aws ssm put-parameter --name /seo/<stage>/lemonsqueezy-api-key --type SecureString --value <ls_api_key>
    //   aws ssm put-parameter --name /seo/<stage>/lemonsqueezy-webhook-secret --type SecureString --value <ls_webhook_secret>
    const lemonSqueezyApiKeyParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'LemonSqueezyApiKeyParam',
      { parameterName: cfg.lemonSqueezyApiKeyParam },
    );
    const lemonSqueezyWebhookSecretParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'LemonSqueezyWebhookSecretParam',
      { parameterName: cfg.lemonSqueezyWebhookSecretParam },
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
      GOOGLE_CLIENT_SECRET_PARAM: cfg.googleClientSecretParam,
      GSC_TOKEN_KEY_PARAM: cfg.gscTokenKeyParam,
      WEB_ORIGIN: cfg.webOrigin,
      LEMONSQUEEZY_API_KEY_PARAM: cfg.lemonSqueezyApiKeyParam,
      LEMONSQUEEZY_WEBHOOK_SECRET_PARAM: cfg.lemonSqueezyWebhookSecretParam,
      LEMONSQUEEZY_STORE_ID: cfg.lemonSqueezyStoreId,
      LEMONSQUEEZY_VARIANT_PAID: cfg.lemonSqueezyVariantPaid,
      LEMONSQUEEZY_VARIANT_EXPERT: cfg.lemonSqueezyVariantExpert,
      GITHUB_APP_SLUG: cfg.githubAppSlug,
      GITHUB_APP_CLIENT_ID: cfg.githubAppClientId,
      GITHUB_APP_KEY_PARAM: cfg.githubAppKeyParam,
    };

    // ESM output: esbuild rewrites CommonJS `require` into a shim that throws for
    // anything not bundled. The mongodb driver `require`s Node built-ins (e.g.
    // `timers/promises`) at runtime, so define a real `require` via createRequire.
    const bundling = {
      format: OutputFormat.ESM,
      minify: true,
      sourceMap: true,
      banner: "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
    };

    // Lambda entries live in apps/* and import @shared/* — both outside this
    // standalone infra package. Point esbuild at the monorepo root so it can
    // resolve workspace source and the root lockfile during bundling.
    const projectRoot = join(__dirname, '../..');
    const depsLockFilePath = join(projectRoot, 'package-lock.json');

    // Dead-letter queue: scan tasks that fail repeatedly land here instead of
    // retrying/expiring silently. 14-day retention gives time to inspect.
    const scanDlq = new Queue(this, 'ScanDlq', {
      retentionPeriod: Duration.days(14),
    });

    // Scan task queue. Visibility timeout >= worker timeout so an in-flight
    // message isn't redelivered while the worker is still processing it.
    // After maxReceiveCount failed deliveries the message moves to the DLQ.
    const scanQueue = new Queue(this, 'ScanQueue', {
      visibilityTimeout: Duration.seconds(180),
      deadLetterQueue: { queue: scanDlq, maxReceiveCount: 3 },
    });

    // Dead-letter queue: strategy tasks that fail repeatedly land here instead
    // of retrying/expiring silently. 14-day retention gives time to inspect.
    const strategyDlq = new Queue(this, 'StrategyDlq', {
      retentionPeriod: Duration.days(14),
    });

    // Strategy task queue. Visibility timeout > worker timeout (below: 15 min,
    // the Lambda max) so an in-flight message isn't redelivered while the worker
    // is still processing it. After maxReceiveCount failed deliveries the
    // message moves to the DLQ.
    const strategyQueue = new Queue(this, 'StrategyQueue', {
      visibilityTimeout: Duration.minutes(16),
      deadLetterQueue: { queue: strategyDlq, maxReceiveCount: 3 },
    });

    // Provider API credentials (#43). Same out-of-band SecureString pattern as
    // every other secret — only NAMEs reach this template; @shared/providers
    // `resolveProviderSecret` fetches + caches the values at runtime. Each
    // Lambda is granted only the keys it actually calls.
    //   aws ssm put-parameter --name /seo/<stage>/dataforseo-login --type SecureString --value <login>
    //   aws ssm put-parameter --name /seo/<stage>/openrouter-api-key --type SecureString --value <key>
    const dataForSeoLoginParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'DataForSeoLoginParam',
      { parameterName: cfg.dataForSeoLoginParam },
    );
    const dataForSeoPasswordParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'DataForSeoPasswordParam',
      { parameterName: cfg.dataForSeoPasswordParam },
    );
    const openRouterApiKeyParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'OpenRouterApiKeyParam',
      { parameterName: cfg.openRouterApiKeyParam },
    );
    const youtubeApiKeyParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'YoutubeApiKeyParam',
      { parameterName: cfg.youtubeApiKeyParam },
    );
    const falKeyParam = StringParameter.fromSecureStringParameterAttributes(this, 'FalKeyParam', {
      parameterName: cfg.falKeyParam,
    });

    /** DataForSEO credential NAMEs — for the Lambdas that query DataForSEO. */
    const dataForSeoEnv = {
      DATAFORSEO_LOGIN_PARAM: cfg.dataForSeoLoginParam,
      DATAFORSEO_PASSWORD_PARAM: cfg.dataForSeoPasswordParam,
    };

    /** Grants the DataForSEO credentials to a function that queries DataForSEO. */
    const grantDataForSeo = (fn: NodejsFunction) => {
      dataForSeoLoginParam.grantRead(fn);
      dataForSeoPasswordParam.grantRead(fn);
    };

    // API Lambda — produces scan tasks.
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      entry: join(projectRoot, 'apps/api/src/index.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        ...authEnv,
        ...dataForSeoEnv,
        SCAN_QUEUE_URL: scanQueue.queueUrl,
        STRATEGY_QUEUE_URL: strategyQueue.queueUrl,
      },
      bundling,
    });
    scanQueue.grantSendMessages(apiFn);
    strategyQueue.grantSendMessages(apiFn);
    grantDataForSeo(apiFn);
    jwtSecretParam.grantRead(apiFn);
    googleClientSecretParam.grantRead(apiFn);
    gscTokenKeyParam.grantRead(apiFn);
    mongoUriParam.grantRead(apiFn);
    lemonSqueezyApiKeyParam.grantRead(apiFn);
    lemonSqueezyWebhookSecretParam.grantRead(apiFn);
    githubAppKeyParam.grantRead(apiFn);

    // Scanner worker Lambda — consumes scan tasks from the queue.
    const workerFn = new NodejsFunction(this, 'WorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/index.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        ...dataForSeoEnv,
        OPENROUTER_API_KEY_PARAM: cfg.openRouterApiKeyParam,
      },
      bundling,
    });
    workerFn.addEventSource(new SqsEventSource(scanQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(workerFn);
    grantDataForSeo(workerFn);
    openRouterApiKeyParam.grantRead(workerFn);

    // Strategy worker Lambda — consumes strategy tasks from the queue.
    const strategyWorkerFn = new NodejsFunction(this, 'StrategyWorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/strategy.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(15),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        ...dataForSeoEnv,
        OPENROUTER_API_KEY_PARAM: cfg.openRouterApiKeyParam,
      },
      bundling,
    });
    strategyWorkerFn.addEventSource(new SqsEventSource(strategyQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(strategyWorkerFn);
    grantDataForSeo(strategyWorkerFn);
    openRouterApiKeyParam.grantRead(strategyWorkerFn);

    // Dead-letter queue: generation tasks that fail repeatedly land here.
    const generationDlq = new Queue(this, 'GenerationDlq', {
      retentionPeriod: Duration.days(14),
    });

    // Generation task queue. Visibility timeout >= worker timeout so an
    // in-flight message isn't redelivered mid-generation. After maxReceiveCount
    // failed deliveries the message moves to the DLQ.
    const generationQueue = new Queue(this, 'GenerationQueue', {
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: { queue: generationDlq, maxReceiveCount: 3 },
    });

    // Article images (#51): private per-stage bucket + CloudFront (OAC) — durable,
    // provider-independent image URLs. Objects are immutable at a given key
    // (retries overwrite BEFORE the URL is stored), so long default TTLs are safe.
    const imagesBucket = new Bucket(this, 'ImagesBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });
    const imagesCdn = new Distribution(this, 'ImagesCdn', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(imagesBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
      },
    });

    // Dead-letter queue: image tasks that fail repeatedly land here.
    const imagesDlq = new Queue(this, 'ImagesDlq', {
      retentionPeriod: Duration.days(14),
    });

    // Image task queue. Visibility timeout >= worker timeout so an in-flight
    // message isn't redelivered mid-generation (image generation is slow).
    const imagesQueue = new Queue(this, 'ImagesQueue', {
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: { queue: imagesDlq, maxReceiveCount: 3 },
    });

    // Images worker Lambda — consumes image tasks; plans, generates, and stores
    // article images. FAL_KEY follows the existing synth-time provider-secret
    // pattern (SSM provisioning deferred — #9/#43).
    const imagesWorkerFn = new NodejsFunction(this, 'ImagesWorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/images.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(10),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        OPENROUTER_API_KEY_PARAM: cfg.openRouterApiKeyParam,
        FAL_KEY_PARAM: cfg.falKeyParam,
        IMAGES_BUCKET: imagesBucket.bucketName,
        IMAGES_CDN_DOMAIN: imagesCdn.distributionDomainName,
      },
      bundling,
    });
    imagesWorkerFn.addEventSource(new SqsEventSource(imagesQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(imagesWorkerFn);
    openRouterApiKeyParam.grantRead(imagesWorkerFn);
    falKeyParam.grantRead(imagesWorkerFn);
    imagesBucket.grantPut(imagesWorkerFn);

    // Generation worker Lambda — consumes generation tasks; produces articles.
    const generationWorkerFn = new NodejsFunction(this, 'GenerationWorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/generation.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(10),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        OPENROUTER_API_KEY_PARAM: cfg.openRouterApiKeyParam,
        YOUTUBE_API_KEY_PARAM: cfg.youtubeApiKeyParam,
        IMAGES_QUEUE_URL: imagesQueue.queueUrl,
      },
      bundling,
    });
    generationWorkerFn.addEventSource(new SqsEventSource(generationQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(generationWorkerFn);
    openRouterApiKeyParam.grantRead(generationWorkerFn);
    youtubeApiKeyParam.grantRead(generationWorkerFn);
    imagesQueue.grantSendMessages(generationWorkerFn);

    // Scheduler Lambda — daily EventBridge trigger; fans out due entries to the
    // generation queue. No provider secret needed (it only reads Mongo + sends SQS).
    const generationSchedulerFn = new NodejsFunction(this, 'GenerationSchedulerFn', {
      entry: join(projectRoot, 'apps/worker/src/generation-scheduler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(2),
      memorySize: 256,
      environment: {
        ...mongoEnv,
        GENERATION_QUEUE_URL: generationQueue.queueUrl,
      },
      bundling,
    });
    generationQueue.grantSendMessages(generationSchedulerFn);
    mongoUriParam.grantRead(generationSchedulerFn);

    // Daily at 07:00 UTC — articles generate on/after their scheduled day.
    new Rule(this, 'GenerationSchedule', {
      schedule: Schedule.cron({ minute: '0', hour: '7' }),
      targets: [new LambdaFunction(generationSchedulerFn)],
    });

    // DB-init Lambda — creates MongoDB indexes. Invoked at deploy time by the
    // custom resource below (Create/Update), so indexes exist before traffic.
    const dbInitFn = new NodejsFunction(this, 'DbInitFn', {
      entry: join(projectRoot, 'scripts/lambda-db-init.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 256,
      environment: mongoEnv,
      bundling,
    });
    mongoUriParam.grantRead(dbInitFn);

    const dbInitProvider = new Provider(this, 'DbInitProvider', {
      onEventHandler: dbInitFn,
      logRetention: RetentionDays.ONE_WEEK,
    });

    // Re-run index creation on every deploy by varying a property so CFN sees a
    // resource update (indexes are idempotent, so re-running is safe/cheap).
    new CustomResource(this, 'DbInitResource', {
      serviceToken: dbInitProvider.serviceToken,
      removalPolicy: RemovalPolicy.DESTROY,
      properties: { deployedAt: Date.now().toString() },
    });

    // Public HTTP API -> API Lambda.
    const httpApi = new HttpApi(this, 'HttpApi');
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', apiFn),
    });

    // Discoverable endpoint: the deployed API base URL. Feed this to the web
    // app as NEXT_PUBLIC_API_URL (the typed client appends /api/v0/...).
    new CfnOutput(this, 'HttpApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'Base URL of the HTTP API — set as NEXT_PUBLIC_API_URL for the web app',
    });

    // Admin API (epic #150) — its own Lambda + HTTP API: separate URL, separate
    // secret, separate bundle. The customer Lambda contains zero admin code and
    // the admin Lambda is granted ONLY its own secrets — never the customer JWT
    // secret, GSC token key, Google client secret, or LemonSqueezy params.
    //
    // Admin signing secret, created out-of-band like the others:
    //   aws ssm put-parameter --name /seo/<stage>/admin/jwt-secret --type SecureString --value <secret>
    const adminJwtSecretParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'AdminJwtSecretParam',
      { parameterName: cfg.adminJwtSecretParam },
    );

    // Operator allowlist: a PLAIN String parameter (comma-separated emails —
    // not secret), short-cached at runtime so edits apply without a redeploy:
    //   aws ssm put-parameter --name /seo/<stage>/admin/operators --type String --value "a@x.com,b@y.com"
    const adminOperatorsParam = StringParameter.fromStringParameterName(
      this,
      'AdminOperatorsParam',
      cfg.adminOperatorsParam,
    );

    const adminFn = new NodejsFunction(this, 'AdminFn', {
      entry: join(projectRoot, 'apps/api/src/admin-index.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        ...dataForSeoEnv, // operator keyword research (DataForSEO, phase 1)
        ADMIN_JWT_SECRET_PARAM: cfg.adminJwtSecretParam,
        ADMIN_OPERATORS_PARAM: cfg.adminOperatorsParam,
        GOOGLE_CLIENT_ID: cfg.googleClientId,
        SCAN_QUEUE_URL: scanQueue.queueUrl,
        STRATEGY_QUEUE_URL: strategyQueue.queueUrl,
        GENERATION_QUEUE_URL: generationQueue.queueUrl,
        IMAGES_QUEUE_URL: imagesQueue.queueUrl,
      },
      bundling,
    });
    scanQueue.grantSendMessages(adminFn);
    strategyQueue.grantSendMessages(adminFn);
    generationQueue.grantSendMessages(adminFn);
    imagesQueue.grantSendMessages(adminFn);
    mongoUriParam.grantRead(adminFn);
    grantDataForSeo(adminFn);
    adminJwtSecretParam.grantRead(adminFn);
    adminOperatorsParam.grantRead(adminFn);

    const adminHttpApi = new HttpApi(this, 'AdminHttpApi');
    adminHttpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('AdminApiIntegration', adminFn),
    });

    new CfnOutput(this, 'AdminHttpApiUrl', {
      value: adminHttpApi.apiEndpoint,
      description: 'Base URL of the admin HTTP API — point apps/admin at this',
    });

    // Image CDN domain — the base of every stored article-image URL.
    new CfnOutput(this, 'ImagesCdnDomain', { value: imagesCdn.distributionDomainName });
  }
}
