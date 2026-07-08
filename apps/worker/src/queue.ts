import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { GenerateTask } from '@shared/schemas';

// SQS_ENDPOINT points at local ElasticMQ in dev; unset in AWS (SDK uses the role).
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

/** Enqueue one article-generation task for the generation worker (#55). */
export async function enqueueGenerateTask(task: GenerateTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.GENERATION_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
