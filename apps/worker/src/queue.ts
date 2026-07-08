import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { GenerateTask, ImageTask } from '@shared/schemas';

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

/** Enqueue one article-image task for the images worker (#51). */
export async function enqueueImageTask(task: ImageTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.IMAGES_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
