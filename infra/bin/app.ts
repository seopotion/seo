#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';

const app = new App();

new ApiStack(app, 'SeoApiStack', {
  // Account/region come from the standard CDK env vars when deploying;
  // synth is region-agnostic so this is safe to leave undefined.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
});
