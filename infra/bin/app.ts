#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';

const app = new App();

// Account/region come from the standard CDK env vars when deploying; synth is
// region-agnostic so this is safe to leave undefined.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION };

new ApiStack(app, 'SeoApiStack-staging', { env, stage: 'staging' });

// Termination protection on prod only: deleting this stack drops the customer
// image bucket's CloudFront distribution and every queue. Staging stays
// deletable so it can be torn down and rebuilt freely.
new ApiStack(app, 'SeoApiStack-prod', { env, stage: 'prod', terminationProtection: true });
