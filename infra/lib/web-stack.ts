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

// Confirmed via Task 3's smoke build + open-next.output.json: the top-level
// index.mjs in server-functions/default/ is a re-export shim into the nested
// apps/web/index.mjs bundle, so the handler stays at the top level.
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
