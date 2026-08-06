#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { openNextBuildExists, WebStack } from '../lib/web-stack';

const app = new App();

// Account/region come from the standard CDK env vars when deploying; synth is
// region-agnostic so this is safe to leave undefined.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new ApiStack(app, 'SeoApiStack-staging', { env, stage: 'staging' });

// Termination protection on prod only: deleting this stack drops the customer
// image bucket's CloudFront distribution and every queue. Staging stays
// deletable so it can be torn down and rebuilt freely.
new ApiStack(app, 'SeoApiStack-prod', { env, stage: 'prod', terminationProtection: true });

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
