/**
 * Minimal SQS producer for the CLI. Mirrors apps/api/src/clients/sqs.ts so the
 * `db set-plan` escape hatch can kick off the strategy pipeline the same way
 * POST /setup/finalize does. `SQS_ENDPOINT` targets local ElasticMQ; unset in
 * deployed envs (real AWS + ambient credentials).
 */
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { StrategyTask } from '@shared/schemas';

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

/** Enqueue a 30-day strategy task for the strategy worker (#47). */
export async function enqueueStrategyTask(task: StrategyTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.STRATEGY_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
