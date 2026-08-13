import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { KeywordRepo, OrgRepo, StrategyRunRepo } from '@shared/db';
import type { StrategyRun } from '@shared/schemas';
import { StrategyFatalError } from './errors';
import { runLocalStrategy } from './run';

/** Snapshot the org into a fresh running strategy_runs doc. */
export async function createStrategyRun(orgId: string): Promise<StrategyRun> {
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets) throw new StrategyFatalError(`org ${orgId} missing or has no presets`);
  const scheduled = await KeywordRepo.listByOrg(orgId);
  return StrategyRunRepo.create({
    org_id: orgId,
    status: 'running',
    input: {
      website_url: org.website_url,
      presets: org.presets,
      existing_keywords: scheduled.map((k) => k.keyword),
    },
  });
}

/**
 * Start a strategy run. Deployed (STRATEGY_STATE_MACHINE_ARN set): starts a
 * Step Functions execution named strategy-<run_id>. Local: runs the sequential
 * in-process runner fire-and-forget, keeping `npm run dev` infra-free. Callers
 * keep their own OrgRepo.claimStrategy guard, exactly as with the old queue.
 */
export async function launchStrategy(orgId: string): Promise<{ run_id: string }> {
  const run = await createStrategyRun(orgId);
  const arn = process.env.STRATEGY_STATE_MACHINE_ARN;
  if (arn) {
    const sfn = new SFNClient({});
    await sfn.send(
      new StartExecutionCommand({
        stateMachineArn: arn,
        name: `strategy-${run.id}`,
        input: JSON.stringify({ run_id: run.id, org_id: orgId }),
      }),
    );
  } else {
    void runLocalStrategy(run.id).catch((err) => {
      console.error(`[strategy] local run ${run.id} failed`, err);
    });
  }
  return { run_id: run.id };
}
