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
import {
  CachePolicy,
  Function as CloudFrontFunction,
  Distribution,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Alarm, TreatMissingData } from 'aws-cdk-lib/aws-cloudwatch';
import { Rule, Schedule } from 'aws-cdk-lib/aws-events';
import { LambdaFunction } from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import {
  Choice,
  Condition,
  DefinitionBody,
  JsonPath,
  StateMachine,
  TaskInput,
  Timeout,
} from 'aws-cdk-lib/aws-stepfunctions';
import { LambdaInvoke } from 'aws-cdk-lib/aws-stepfunctions-tasks';
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
    // Granted only to the API and dedicated publish worker.
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

    const publishDlq = new Queue(this, 'PublishDlq', {
      retentionPeriod: Duration.days(14),
    });

    const publishQueue = new Queue(this, 'PublishQueue', {
      visibilityTimeout: Duration.minutes(6),
      deadLetterQueue: { queue: publishDlq, maxReceiveCount: 3 },
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
        PUBLISH_QUEUE_URL: publishQueue.queueUrl,
      },
      bundling,
    });
    scanQueue.grantSendMessages(apiFn);
    publishQueue.grantSendMessages(apiFn);
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

    // Strategy stage Lambda — invoked per pipeline stage by the Step Functions
    // state machine below (#56), and by the EventBridge failure rule on a
    // terminal execution failure. Timeout matches the Lambda ceiling; each
    // stage's own progress is bounded by the shorter per-Task `taskTimeout`.
    const strategyStageFn = new NodejsFunction(this, 'StrategyStageFn', {
      entry: join(projectRoot, 'apps/worker/src/strategy.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(10),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        ...dataForSeoEnv,
        OPENROUTER_API_KEY_PARAM: cfg.openRouterApiKeyParam,
      },
      bundling,
    });
    mongoUriParam.grantRead(strategyStageFn);
    grantDataForSeo(strategyStageFn);
    openRouterApiKeyParam.grantRead(strategyStageFn);

    // Strategy state machine (#56): one Task state per pipeline stage, all invoking
    // the same stage Lambda with {run_id, org_id, stage}. Retries are per stage and
    // only for StrategyRetryableError (+ Lambda service errors + state timeouts);
    // a StrategyFatalError fails the execution immediately. No Catch states — a
    // failed execution must stay redrivable from the failed state, so org-failure
    // stamping happens via the EventBridge rule below instead.
    const stageState = (stage: string, timeout: Duration) => {
      const task = new LambdaInvoke(this, `Strategy_${stage}`, {
        lambdaFunction: strategyStageFn,
        payload: TaskInput.fromObject({
          run_id: JsonPath.stringAt('$.run_id'),
          org_id: JsonPath.stringAt('$.org_id'),
          stage,
        }),
        resultPath: JsonPath.DISCARD, // keep {run_id, org_id} flowing to the next state
        taskTimeout: Timeout.duration(timeout),
      });
      task.addRetry({
        errors: ['StrategyRetryableError', 'States.Timeout'],
        maxAttempts: 3,
        interval: Duration.seconds(30),
        backoffRate: 2,
      });
      return task;
    };

    const strategyDefinition = stageState('gather', Duration.minutes(5))
      .next(stageState('enrich', Duration.minutes(5)))
      .next(stageState('triage', Duration.minutes(5)))
      .next(stageState('serp_fetch', Duration.minutes(8)))
      .next(stageState('plan', Duration.minutes(5)))
      .next(stageState('persist_schedule', Duration.minutes(5)));

    const strategyStateMachine = new StateMachine(this, 'StrategyStateMachine', {
      definitionBody: DefinitionBody.fromChainable(strategyDefinition),
      timeout: Duration.hours(1),
    });

    strategyStateMachine.grantStartExecution(apiFn);
    apiFn.addEnvironment('STRATEGY_STATE_MACHINE_ARN', strategyStateMachine.stateMachineArn);

    // Terminal-failure handling: Step Functions emits execution status changes to
    // EventBridge; on FAILED/TIMED_OUT/ABORTED the stage Lambda (same fn, different
    // event shape) marks the org + run failed. Kept OUT of the state machine so
    // redrive resumes at the failed stage.
    new Rule(this, 'StrategyExecutionFailedRule', {
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          status: ['FAILED', 'TIMED_OUT', 'ABORTED'],
          stateMachineArn: [strategyStateMachine.stateMachineArn],
        },
      },
      targets: [new LambdaFunction(strategyStageFn)],
    });

    // Replaces the strategy DLQ as the "a customer got no plan" pager signal.
    new Alarm(this, 'StrategyExecutionsFailedAlarm', {
      metric: strategyStateMachine.metricFailed({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });

    // Article images (#51): private per-stage bucket + CloudFront (OAC) — durable,
    // provider-independent image URLs. Objects are immutable at a given key
    // (retries overwrite BEFORE the URL is stored), so long default TTLs are safe.
    const imagesBucket = new Bucket(this, 'ImagesBucket', {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });
    // Customer sites embed these URLs, and image components across Astro, Next
    // and Nuxt routinely set `crossorigin="anonymous"` on the <img>. That makes
    // the browser fetch in CORS mode and discard a response carrying no
    // `Access-Control-Allow-Origin` — the image downloads fine and still
    // renders blank.
    //
    // A viewer-response function rather than a response headers policy: the
    // managed SimpleCORS policy withholds the header for requests CloudFront
    // doesn't classify as simple, and Chrome sends `priority: i` on every image
    // fetch, which trips exactly that. Same object, same edge — it answers curl
    // with `*` and answers Chrome with nothing. Functions run on every viewer
    // response, cache hits included, with no request classifier in the path.
    // A static `*` needs no `Vary` and adds nothing to the cache key.
    const imagesCorsFn = new CloudFrontFunction(this, 'ImagesCorsFn', {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromInline(
        'function handler(event) {\n' +
          '  var response = event.response;\n' +
          "  response.headers['access-control-allow-origin'] = { value: '*' };\n" +
          '  return response;\n' +
          '}',
      ),
    });
    const imagesCdn = new Distribution(this, 'ImagesCdn', {
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(imagesBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        functionAssociations: [
          { function: imagesCorsFn, eventType: FunctionEventType.VIEWER_RESPONSE },
        ],
      },
    });

    const publishWorkerFn = new NodejsFunction(this, 'PublishWorkerFn', {
      entry: join(projectRoot, 'apps/worker/src/publish.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(5),
      memorySize: 512,
      environment: {
        ...mongoEnv,
        GSC_TOKEN_KEY_PARAM: cfg.gscTokenKeyParam,
        GITHUB_APP_CLIENT_ID: cfg.githubAppClientId,
        GITHUB_APP_KEY_PARAM: cfg.githubAppKeyParam,
      },
      bundling,
    });
    publishWorkerFn.addEventSource(new SqsEventSource(publishQueue, { batchSize: 1 }));
    mongoUriParam.grantRead(publishWorkerFn);
    gscTokenKeyParam.grantRead(publishWorkerFn);
    githubAppKeyParam.grantRead(publishWorkerFn);

    // Scheduler Lambda — daily EventBridge trigger; fans out due entries as
    // article-generation state machine executions (gains ARTICLE_STATE_MACHINE_ARN
    // after the state machine below is defined). No provider secret needed (it
    // only reads Mongo + starts executions).
    const generationSchedulerFn = new NodejsFunction(this, 'GenerationSchedulerFn', {
      entry: join(projectRoot, 'apps/worker/src/generation-scheduler.ts'),
      projectRoot,
      depsLockFilePath,
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.minutes(2),
      memorySize: 256,
      environment: mongoEnv,
      bundling,
    });
    mongoUriParam.grantRead(generationSchedulerFn);

    // Daily at 07:00 UTC — articles generate on/after their scheduled day.
    new Rule(this, 'GenerationSchedule', {
      schedule: Schedule.cron({ minute: '0', hour: '7' }),
      targets: [new LambdaFunction(generationSchedulerFn)],
    });

    // Article stage Lambda — invoked once per Step Functions Task state with
    // {run_id, org_id, stage} by the article state machine below, and by the
    // EventBridge failure rule on a terminal execution failure. Env is the
    // union of the deleted GenerationWorkerFn's and ImagesWorkerFn's (#178).
    const articleStageFn = new NodejsFunction(this, 'ArticleStageFn', {
      entry: join(projectRoot, 'apps/worker/src/article-run.ts'),
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
        FAL_KEY_PARAM: cfg.falKeyParam,
        IMAGES_BUCKET: imagesBucket.bucketName,
        IMAGES_CDN_DOMAIN: imagesCdn.distributionDomainName,
        PUBLISH_QUEUE_URL: publishQueue.queueUrl,
        GSC_TOKEN_KEY_PARAM: cfg.gscTokenKeyParam,
      },
      bundling,
    });
    mongoUriParam.grantRead(articleStageFn);
    openRouterApiKeyParam.grantRead(articleStageFn);
    youtubeApiKeyParam.grantRead(articleStageFn);
    falKeyParam.grantRead(articleStageFn);
    gscTokenKeyParam.grantRead(articleStageFn);
    imagesBucket.grantPut(articleStageFn);
    publishQueue.grantSendMessages(articleStageFn);

    // Article state machine (2026-08-28 spec): linear stages + a readability
    // Choice that loops humanize until the stage reports readability_ok (the
    // stage itself caps the loop at 3 passes, so no machine-side counter).
    // Same recipe as strategy: per-stage retries on ArticleRetryableError, no
    // Catch states (redrive-friendly), EventBridge failure stamping below.
    const articleStage = (stage: string, timeout: Duration) => {
      const task = new LambdaInvoke(this, `Article_${stage}`, {
        lambdaFunction: articleStageFn,
        payload: TaskInput.fromObject({
          run_id: JsonPath.stringAt('$.run_id'),
          org_id: JsonPath.stringAt('$.org_id'),
          stage,
        }),
        resultPath: JsonPath.DISCARD,
        taskTimeout: Timeout.duration(timeout),
      });
      task.addRetry({
        errors: ['ArticleRetryableError', 'States.Timeout'],
        maxAttempts: 3,
        interval: Duration.seconds(30),
        backoffRate: 2,
      });
      return task;
    };

    // humanize is the one state whose output survives: the Choice reads it.
    const humanizeTask = new LambdaInvoke(this, 'Article_humanize', {
      lambdaFunction: articleStageFn,
      payload: TaskInput.fromObject({
        run_id: JsonPath.stringAt('$.run_id'),
        org_id: JsonPath.stringAt('$.org_id'),
        stage: 'humanize',
      }),
      resultSelector: { 'readability_ok.$': '$.Payload.readability_ok' },
      resultPath: '$.humanize',
      taskTimeout: Timeout.duration(Duration.minutes(5)),
    });
    humanizeTask.addRetry({
      errors: ['ArticleRetryableError', 'States.Timeout'],
      maxAttempts: 3,
      interval: Duration.seconds(30),
      backoffRate: 2,
    });

    const finalizeChain = articleStage('finalize', Duration.minutes(5))
      .next(articleStage('images_plan', Duration.minutes(3)))
      .next(articleStage('images_render', Duration.minutes(9)))
      .next(articleStage('handoff_publish', Duration.minutes(2)));

    const readabilityGate = new Choice(this, 'Article_readability_gate')
      .when(Condition.booleanEquals('$.humanize.readability_ok', true), finalizeChain)
      .otherwise(humanizeTask);

    const articleDefinition = articleStage('prepare', Duration.minutes(3))
      .next(articleStage('outline', Duration.minutes(5)))
      .next(articleStage('draft', Duration.minutes(5)))
      .next(humanizeTask.next(readabilityGate));

    const articleStateMachine = new StateMachine(this, 'ArticleStateMachine', {
      definitionBody: DefinitionBody.fromChainable(articleDefinition),
      timeout: Duration.hours(1),
    });

    articleStateMachine.grantStartExecution(apiFn);
    apiFn.addEnvironment('ARTICLE_STATE_MACHINE_ARN', articleStateMachine.stateMachineArn);
    articleStateMachine.grantStartExecution(generationSchedulerFn);
    generationSchedulerFn.addEnvironment(
      'ARTICLE_STATE_MACHINE_ARN',
      articleStateMachine.stateMachineArn,
    );

    new Rule(this, 'ArticleExecutionFailedRule', {
      eventPattern: {
        source: ['aws.states'],
        detailType: ['Step Functions Execution Status Change'],
        detail: {
          status: ['FAILED', 'TIMED_OUT', 'ABORTED'],
          stateMachineArn: [articleStateMachine.stateMachineArn],
        },
      },
      targets: [new LambdaFunction(articleStageFn)],
    });

    // Replaces the generation/images DLQs as the "a customer got no article" signal.
    new Alarm(this, 'ArticleExecutionsFailedAlarm', {
      metric: articleStateMachine.metricFailed({ period: Duration.minutes(5) }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
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
        STRATEGY_STATE_MACHINE_ARN: strategyStateMachine.stateMachineArn,
        ARTICLE_STATE_MACHINE_ARN: articleStateMachine.stateMachineArn,
      },
      bundling,
    });
    scanQueue.grantSendMessages(adminFn);
    mongoUriParam.grantRead(adminFn);
    grantDataForSeo(adminFn);
    adminJwtSecretParam.grantRead(adminFn);
    adminOperatorsParam.grantRead(adminFn);
    strategyStateMachine.grantStartExecution(adminFn);
    articleStateMachine.grantStartExecution(adminFn);

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
