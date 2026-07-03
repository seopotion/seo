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
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Provider } from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';

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
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const mongoEnv = {
      MONGO_URI: process.env.MONGO_URI ?? '',
      MONGO_DB: process.env.MONGO_DB ?? 'seo',
      // Powertools Logger level (per-function service name is set in code).
      POWERTOOLS_LOG_LEVEL: process.env.POWERTOOLS_LOG_LEVEL ?? 'INFO',
    };

    // JWT signing secret lives in an SSM SecureString created out-of-band (so
    // the secret never enters this template). We reference it by NAME and grant
    // the API Lambda read; the API fetches + caches it at runtime via Powertools
    // Parameters. See apps/api/src/auth/secret.ts.
    //   aws ssm put-parameter --name /seo/jwt-secret --type SecureString --value <secret>
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

    // ESM output: esbuild rewrites CommonJS `require` into a shim that throws for
    // anything not bundled. The mongodb driver `require`s Node built-ins (e.g.
    // `timers/promises`) at runtime, so define a real `require` via createRequire.
    const bundling = {
      format: OutputFormat.ESM,
      minify: true,
      sourceMap: true,
      banner:
        "import{createRequire as __cr}from'module';const require=__cr(import.meta.url);",
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

    // API Lambda — produces scan tasks.
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      entry: join(projectRoot, 'apps/api/src/index.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: { ...mongoEnv, ...authEnv, SCAN_QUEUE_URL: scanQueue.queueUrl },
      bundling,
    });
    scanQueue.grantSendMessages(apiFn);
    jwtSecretParam.grantRead(apiFn);

    // Scanner worker Lambda — consumes scan tasks from the queue.
    const workerFn = new NodejsFunction(this, 'WorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/index.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: mongoEnv,
      bundling,
    });
    workerFn.addEventSource(new SqsEventSource(scanQueue, { batchSize: 1 }));

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
  }
}
