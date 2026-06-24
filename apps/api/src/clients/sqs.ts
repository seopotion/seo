import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { ScanTask } from '@shared/schemas';

// Module-scope client, reused across warm Lambda invocations (region/creds from
// the Lambda execution environment).
const sqs = new SQSClient({});

/** Enqueue a website scan task for the scanner worker. */
export async function enqueueScanTask(task: ScanTask): Promise<void> {
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: process.env.SCAN_QUEUE_URL,
      MessageBody: JSON.stringify(task),
    }),
  );
}
