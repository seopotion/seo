import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { GenerateTask, ImageTask, PublishTask, ScanTask, StrategyTask } from '@shared/schemas';

// `SQS_ENDPOINT` points the client at a local SQS (ElasticMQ via docker compose)
// for local dev; unset in deployed envs, where the SDK uses real AWS + the
// Lambda execution role.
const endpoint = process.env.SQS_ENDPOINT;
const sqs = new SQSClient(
  endpoint
    ? {
        endpoint,
        region: 'elasticmq',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {},
);

/** Enqueue a website scan task for the scanner worker. */
export async function enqueueScanTask(task: ScanTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SCAN_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}

/** Enqueue a 30-day strategy task for the strategy worker (#47). */
export async function enqueueStrategyTask(task: StrategyTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.STRATEGY_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}

/** Enqueue an article-generation task for the generation worker (admin
 * generate-now, epic #150; the worker's `claimGeneration` dedupes). */
export async function enqueueGenerateTask(task: GenerateTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.GENERATION_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}

/** Enqueue an article-image task for the images worker (admin replay, epic
 * #150; the worker's set-if-absent plan + per-slot guards make replay safe). */
export async function enqueueImageTask(task: ImageTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.IMAGES_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}

export async function enqueuePublishTask(task: PublishTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.PUBLISH_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
