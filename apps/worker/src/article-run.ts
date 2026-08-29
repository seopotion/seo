import {
  executeArticleStage,
  getArticleStageClients,
  markArticleRunFailed,
} from '@shared/articles';
import { ARTICLE_STAGES } from '@shared/schemas';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { logger } from './logger';

const StageEvent = z.object({
  run_id: z.string(),
  org_id: z.string(),
  stage: z.enum(ARTICLE_STAGES),
});

const ExecutionFailedEvent = z.object({
  'detail-type': z.literal('Step Functions Execution Status Change'),
  detail: z.object({ status: z.string(), input: z.string() }),
});

/**
 * Article stage Lambda — invoked once per Step Functions Task state with
 * {run_id, org_id, stage}, and by the EventBridge rule on terminal execution
 * failure (marks the keyword + run failed). Stage state/checkpoints live in the
 * article_runs collection; see #178. The humanize stage's return value is
 * returned by the handler so Step Functions can read $.Payload.readability_ok.
 */
export const handler = async (
  event: unknown,
  context?: Context,
): Promise<{ readability_ok: boolean } | undefined> => {
  if (context?.awsRequestId) logger.addContext(context);

  const failed = ExecutionFailedEvent.safeParse(event);
  if (failed.success) {
    const input = StageEvent.omit({ stage: true }).safeParse(JSON.parse(failed.data.detail.input));
    if (!input.success) {
      logger.error('article run failure event with unreadable input', { event });
      return;
    }
    logger.appendKeys({ org_id: input.data.org_id, run_id: input.data.run_id });
    try {
      logger.error('article run execution failed', { status: failed.data.detail.status });
      await markArticleRunFailed(input.data.run_id);
    } finally {
      logger.removeKeys(['org_id', 'run_id']);
    }
    return;
  }

  const { run_id, org_id, stage } = StageEvent.parse(event);
  logger.appendKeys({ org_id, run_id, stage });
  try {
    const clients = await getArticleStageClients();
    const result = await executeArticleStage(run_id, stage, clients);
    logger.info('article stage completed', result ? { readability_ok: result.readability_ok } : {});
    return result;
  } catch (err) {
    logger.error('article stage failed', { error: err as Error });
    throw err;
  } finally {
    logger.removeKeys(['org_id', 'run_id', 'stage']);
  }
};
