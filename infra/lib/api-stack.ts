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

    // Strategy task queue. Visibility timeout >= worker timeout so an
    // in-flight message isn't redelivered while the worker is still
    // processing it. After maxReceiveCount failed deliveries the message
    // moves to the DLQ.
    const strategyQueue = new Queue(this, 'StrategyQueue', {
      visibilityTimeout: Duration.minutes(15),
      deadLetterQueue: { queue: strategyDlq, maxReceiveCount: 3 },
    });

    // Provider secret env vars — read from process.env at synth/deploy host.
    // Deployed-secret provisioning (SSM SecureString) is deferred; the `?? ''`
    // fallback is intentional until that lands.
    const providerEnv = {
      DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN ?? '',
      DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD ?? '',
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
        ...providerEnv,
        SCAN_QUEUE_URL: scanQueue.queueUrl,
        STRATEGY_QUEUE_URL: strategyQueue.queueUrl,
      },
      bundling,
    });
    scanQueue.grantSendMessages(apiFn);
    strategyQueue.grantSendMessages(apiFn);
    jwtSecretParam.grantRead(apiFn);
    mongoUriParam.grantRead(apiFn);

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
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
      },
      bundling,
    });
    workerFn.addEventSource(new SqsEventSource(scanQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(workerFn);

    // Strategy worker Lambda — consumes strategy tasks from the queue.
    const strategyWorkerFn = new NodejsFunction(this, 'StrategyWorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/strategy.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(10),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        ...providerEnv,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
      },
      bundling,
    });
    strategyWorkerFn.addEventSource(new SqsEventSource(strategyQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(strategyWorkerFn);

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
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
        FAL_KEY: process.env.FAL_KEY ?? '',
        IMAGES_BUCKET: imagesBucket.bucketName,
        IMAGES_CDN_DOMAIN: imagesCdn.distributionDomainName,
      },
      bundling,
    });
    imagesWorkerFn.addEventSource(new SqsEventSource(imagesQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(imagesWorkerFn);
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
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY ?? '',
        IMAGES_QUEUE_URL: imagesQueue.queueUrl,
      },
      bundling,
    });
    generationWorkerFn.addEventSource(new SqsEventSource(generationQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(generationWorkerFn);
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

    // Image CDN domain — the base of every stored article-image URL.
    new CfnOutput(this, 'ImagesCdnDomain', { value: imagesCdn.distributionDomainName });
  }
}
