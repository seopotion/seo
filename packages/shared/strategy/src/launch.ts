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

export interface LaunchStrategyOptions {
  /**
   * Only affects the local branch (no STRATEGY_STATE_MACHINE_ARN): await
   * runLocalStrategy instead of firing it in the background. Needed by
   * short-lived callers (e.g. the CLI) whose process exits — and tears down
   * shared resources like the Mongo connection — right after launchStrategy
   * resolves, which would otherwise race a fire-and-forget run. Long-lived
   * server callers (API routes, billing) omit this: fire-and-forget is correct
   * there.
   */
  wait?: boolean;
}

/**
 * Start a strategy run. Deployed (STRATEGY_STATE_MACHINE_ARN set): starts a
 * Step Functions execution named strategy-<run_id>. Local: runs the sequential
 * in-process runner, keeping `npm run dev` infra-free — fire-and-forget by
 * default, or awaited when `opts.wait` is set. Callers keep their own
 * OrgRepo.claimStrategy guard, exactly as with the old queue.
 */
export async function launchStrategy(
  orgId: string,
  opts?: LaunchStrategyOptions,
): Promise<{ run_id: string }> {
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
  } else if (opts?.wait) {
    await runLocalStrategy(run.id);
  } else {
    void runLocalStrategy(run.id).catch((err) => {
      console.error(`[strategy] local run ${run.id} failed`, err);
    });
  }
  return { run_id: run.id };
}
