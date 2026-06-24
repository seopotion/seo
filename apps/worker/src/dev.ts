import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SQSEvent, SQSRecord } from 'aws-lambda';
import { handler } from './index';

/**
 * Local worker runner — long-polls the local SQS queue and invokes the same
 * Lambda `handler` for each message (then deletes it). In AWS this is an SQS
 * event source; here we poll. Run with `npm run dev -w worker`.
 */
const endpoint = process.env.SQS_ENDPOINT;
const queueUrl = process.env.SCAN_QUEUE_URL;

if (!queueUrl) {
  throw new Error('SCAN_QUEUE_URL is required for the local worker poller');
}

const sqs = new SQSClient(
  endpoint
    ? {
        endpoint,
        region: 'elasticmq',
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }
    : {},
);

function toRecord(body: string, id: string, receiptHandle: string): SQSRecord {
  return {
    messageId: id,
    receiptHandle,
    body,
    attributes: {} as never,
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: queueUrl as string,
    awsRegion: 'local',
  };
}

console.log(`[worker] polling ${queueUrl}`);

for (;;) {
  const { Messages } = await sqs.send(
    new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 5, WaitTimeSeconds: 5 }),
  );
  if (!Messages?.length) continue;

  const records = Messages.map((m, i) =>
    toRecord(m.Body ?? '', m.MessageId ?? String(i), m.ReceiptHandle ?? ''),
  );
  const event: SQSEvent = { Records: records };

  try {
    await handler(event, {} as never, () => {});
    for (const m of Messages) {
      if (m.ReceiptHandle) {
        await sqs.send(
          new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: m.ReceiptHandle }),
        );
      }
    }
    console.log(`[worker] processed ${records.length} message(s)`);
  } catch (err) {
    console.error('[worker] handler failed; messages will be redelivered', err);
  }
}
