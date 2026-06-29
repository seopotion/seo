import { join } from 'node:path';
import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import { HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Queue } from 'aws-cdk-lib/aws-sqs';
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

    const bundling = { format: OutputFormat.ESM, minify: true, sourceMap: true };

    // Scan task queue. Visibility timeout >= worker timeout so an in-flight
    // message isn't redelivered while the worker is still processing it.
    const scanQueue = new Queue(this, 'ScanQueue', {
      visibilityTimeout: Duration.seconds(180),
    });

    // API Lambda — produces scan tasks.
    const apiFn = new NodejsFunction(this, 'ApiFn', {
      entry: join(__dirname, '../../apps/api/src/index.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: { ...mongoEnv, SCAN_QUEUE_URL: scanQueue.queueUrl },
      bundling,
    });
    scanQueue.grantSendMessages(apiFn);

    // Scanner worker Lambda — consumes scan tasks from the queue.
    const workerFn = new NodejsFunction(this, 'WorkerFn', {
      entry: join(__dirname, '../../apps/worker/src/index.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(120),
      memorySize: 512,
      environment: mongoEnv,
      bundling,
    });
    workerFn.addEventSource(new SqsEventSource(scanQueue, { batchSize: 1 }));

    // Public HTTP API -> API Lambda.
    const httpApi = new HttpApi(this, 'HttpApi');
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration('ApiIntegration', apiFn),
    });
  }
}
