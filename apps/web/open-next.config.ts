import type { OpenNextConfig } from '@opennextjs/aws/types/open-next.js';

// Default AWS config: server + image functions, S3 incremental cache, SQS
// revalidation queue, DynamoDB tag cache — all provisioned by
// infra/lib/web-stack.ts. buildCommand keeps `prebuild` (WP-plugin zip) running.
const config = {
  default: {},
  buildCommand: 'npm run build',
} satisfies OpenNextConfig;

export default config;
