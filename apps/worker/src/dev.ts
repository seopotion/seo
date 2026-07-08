import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { SQSEvent, SQSHandler, SQSRecord } from 'aws-lambda';
import { handler as generationHandler } from './generation';
import { handler as imagesHandler } from './images';
import { handler as scanHandler } from './index';
import { handler as strategyHandler } from './strategy';

/**
 * Local worker runner — long-polls the local SQS queues and invokes the same
 * Lambda handlers for each message (then deletes it). In AWS these are SQS event
 * sources; here we poll. Run with `npm run dev -w worker`. The scan queue is
 * required; the strategy queue is optional (only polled when set).
 */
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

function toRecord(queueUrl: string, body: string, id: string, receiptHandle: string): SQSRecord {
  return {
    messageId: id,
    receiptHandle,
    body,
    attributes: {} as never,
    messageAttributes: {},
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: queueUrl,
    awsRegion: 'local',
  };
}

async function pollQueue(name: string, queueUrl: string, handler: SQSHandler): Promise<never> {
  console.log(`[worker:${name}] polling ${queueUrl}`);
  for (;;) {
    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 5, WaitTimeSeconds: 5 }),
    );
    if (!Messages?.length) continue;
    const records = Messages.map((m, i) =>
      toRecord(queueUrl, m.Body ?? '', m.MessageId ?? String(i), m.ReceiptHandle ?? ''),
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
      console.log(`[worker:${name}] processed ${records.length} message(s)`);
    } catch (err) {
      console.error(`[worker:${name}] handler failed; messages will be redelivered`, err);
    }
  }
}

const scanUrl = process.env.SCAN_QUEUE_URL;
const strategyUrl = process.env.STRATEGY_QUEUE_URL;
const generationUrl = process.env.GENERATION_QUEUE_URL;
const imagesUrl = process.env.IMAGES_QUEUE_URL;
if (!scanUrl) throw new Error('SCAN_QUEUE_URL is required for the local worker poller');

const pollers = [pollQueue('scan', scanUrl, scanHandler)];
if (strategyUrl) pollers.push(pollQueue('strategy', strategyUrl, strategyHandler));
if (generationUrl) pollers.push(pollQueue('generation', generationUrl, generationHandler));
if (imagesUrl) pollers.push(pollQueue('images', imagesUrl, imagesHandler));
await Promise.all(pollers);
