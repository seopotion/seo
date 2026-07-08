import { KeywordRepo } from '@shared/db';
import { MAX_GENERATION_ATTEMPTS } from '@shared/generation';
import type { ScheduledHandler } from 'aws-lambda';
import { logger } from './logger';
import { enqueueGenerateTask } from './queue';

/**
 * Find every due, unlinked, non-terminal planner entry (across orgs) and
 * enqueue one generation task each. Returns the number enqueued. The generation
 * worker re-checks paid entitlement, so this stays a simple finder. See #55.
 */
export async function runScheduler(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const due = await KeywordRepo.listDueForGeneration(today, MAX_GENERATION_ATTEMPTS);
  for (const kw of due) {
    await enqueueGenerateTask({ org_id: kw.org_id, keyword_id: kw.id });
  }
  logger.info('generation scheduler enqueued due entries', { count: due.length, today });
  return due.length;
}

/** EventBridge daily trigger. */
export const handler: ScheduledHandler = async (_event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);
  await runScheduler();
};
