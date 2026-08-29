import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { PublishTask } from '@shared/schemas';

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

export async function enqueuePublishTask(task: PublishTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.PUBLISH_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
