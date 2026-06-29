/**
 * Infrastructure health checks. Each probe returns a ServiceCheck; checkInfra
 * aggregates them. Pure of process I/O — returns a Result for the command layer.
 */
import { GetQueueAttributesCommand, SQSClient } from '@aws-sdk/client-sqs';
import { closeDb, getDb } from '@shared/db';
import type { InfraCheckResult, InfraService, Result, ServiceCheck } from '../types';
import { ok } from '../types';

export const VALID_SERVICES: InfraService[] = ['mongo', 'sqs', 'api'];

async function checkMongo(): Promise<ServiceCheck> {
  const start = Date.now();
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    return { service: 'mongo', available: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { service: 'mongo', available: false, error: (e as Error).message };
  }
}

async function checkSqs(): Promise<ServiceCheck> {
  const start = Date.now();
  const queueUrl = process.env.SCAN_QUEUE_URL;
  if (!queueUrl) {
    return { service: 'sqs', available: false, error: 'SCAN_QUEUE_URL not set' };
  }
  const endpoint = process.env.SQS_ENDPOINT;
  const client = new SQSClient(
    endpoint
      ? {
          endpoint,
          region: 'elasticmq',
          credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
        }
      : {},
  );
  try {
    await client.send(
      new GetQueueAttributesCommand({
        QueueUrl: queueUrl,
        AttributeNames: ['ApproximateNumberOfMessages'],
      }),
    );
    return { service: 'sqs', available: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { service: 'sqs', available: false, error: (e as Error).message };
  } finally {
    client.destroy();
  }
}

async function checkApi(): Promise<ServiceCheck> {
  const start = Date.now();
  const url = `${process.env.API_URL ?? 'http://localhost:8787'}/health`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      return { service: 'api', available: false, error: `HTTP ${res.status}` };
    }
    return { service: 'api', available: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { service: 'api', available: false, error: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

const CHECKS: Record<InfraService, () => Promise<ServiceCheck>> = {
  mongo: checkMongo,
  sqs: checkSqs,
  api: checkApi,
};

export async function checkInfra(
  services: InfraService[] = VALID_SERVICES,
): Promise<Result<InfraCheckResult>> {
  const checked = await Promise.all(services.map((s) => CHECKS[s]()));
  await closeDb(); // release the shared Mongo client so the CLI can exit
  return ok({ allHealthy: checked.every((c) => c.available), services: checked });
}
