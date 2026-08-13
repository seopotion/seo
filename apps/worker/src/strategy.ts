import { STRATEGY_STAGES } from '@shared/schemas';
import { executeStage, getStrategyClients, markRunFailed } from '@shared/strategy';
import type { Context } from 'aws-lambda';
import { z } from 'zod';
import { logger } from './logger';

const StageEvent = z.object({
  run_id: z.string(),
  org_id: z.string(),
  stage: z.enum(STRATEGY_STAGES),
});

const ExecutionFailedEvent = z.object({
  'detail-type': z.literal('Step Functions Execution Status Change'),
  detail: z.object({ status: z.string(), input: z.string() }),
});

/**
 * Strategy stage Lambda — invoked once per Step Functions Task state with
 * {run_id, org_id, stage}, and by the EventBridge rule on terminal execution
 * failure (marks the org failed). Stage state/checkpoints live in the
 * strategy_runs collection; see the 2026-08-13 rearchitect spec and #56.
 */
export const handler = async (event: unknown, context?: Context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  const failed = ExecutionFailedEvent.safeParse(event);
  if (failed.success) {
    const input = StageEvent.omit({ stage: true }).safeParse(JSON.parse(failed.data.detail.input));
    if (!input.success) {
      logger.error('strategy failure event with unreadable input', { event });
      return;
    }
    logger.appendKeys({ org_id: input.data.org_id, run_id: input.data.run_id });
    try {
      logger.error('strategy execution failed', { status: failed.data.detail.status });
      await markRunFailed(input.data.run_id, input.data.org_id);
    } finally {
      logger.removeKeys(['org_id', 'run_id']);
    }
    return;
  }

  const { run_id, org_id, stage } = StageEvent.parse(event);
  logger.appendKeys({ org_id, run_id, stage });
  try {
    const clients = await getStrategyClients();
    await executeStage(run_id, stage, clients);
    logger.info('strategy stage completed');
  } catch (err) {
    logger.error('strategy stage failed', { error: err as Error });
    throw err;
  } finally {
    logger.removeKeys(['org_id', 'run_id', 'stage']);
  }
};
