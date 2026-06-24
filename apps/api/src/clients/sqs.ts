import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { ScanTask } from '@shared/schemas';

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
