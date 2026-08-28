import { launchGeneration } from '@shared/articles';
import { KeywordRepo } from '@shared/db';
import { MAX_GENERATION_ATTEMPTS } from '@shared/generation';
import type { ScheduledHandler } from 'aws-lambda';
import { logger } from './logger';

/**
 * Find every due, unlinked, non-terminal planner entry (across orgs) and
 * launch one article-generation run each. Returns the number found. See #55/#178.
 */
export async function runScheduler(): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const due = await KeywordRepo.listDueForGeneration(today, MAX_GENERATION_ATTEMPTS);
  for (const kw of due) {
    try {
      // wait:true only matters locally (no ARN): run sequentially so a CLI/dev
      // invocation doesn't race process exit. Deployed, this is StartExecution.
      const launched = await launchGeneration(kw.org_id, kw.id, { wait: true });
      if (!launched)
        logger.info('generation launch skipped: keyword not claimable', { keyword_id: kw.id });
    } catch (err) {
      // One bad keyword (missing org/presets, a Mongo blip) must not abort the
      // rest of the day's sweep across every other org. launchGeneration
      // already self-marks the keyword failed before rethrowing.
      logger.error('generation launch failed', { keyword_id: kw.id, error: err as Error });
    }
  }
  logger.info('generation scheduler processed due entries', { count: due.length, today });
  return due.length;
}

/** EventBridge daily trigger. */
export const handler: ScheduledHandler = async (_event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);
  await runScheduler();
};
