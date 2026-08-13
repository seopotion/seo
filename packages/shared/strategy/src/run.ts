import { OrgRepo, StrategyRunRepo } from '@shared/db';
import {
  resolveConfig,
  type StageContext,
  type StrategyWorkState,
  stageEnrich,
  stageGather,
  stagePlan,
  stageSerpFetch,
  stageTriage,
} from '@shared/keywords';
import type { DataForSeoClient, LlmClient } from '@shared/providers';
import { STRATEGY_STAGES, type StrategyRun, type StrategyStageName } from '@shared/schemas';
import { getStrategyClients } from './clients';
import { StrategyFatalError, toStrategyError } from './errors';
import { stagePersistSchedule } from './persist';

type Clients = { dataForSeo: DataForSeoClient; llm: LlmClient };

function toWorkState(run: StrategyRun): StrategyWorkState {
  return {
    candidates: run.candidates,
    belowN: run.below_n,
    rejected: run.rejected,
    seeds: run.seeds,
    stats: run.stats,
  };
}

function toContext(run: StrategyRun, clients: Clients): StageContext {
  const presets = run.input.presets;
  return {
    orgId: run.org_id,
    websiteUrl: run.input.website_url,
    presets,
    competitors: presets.audience.competitors,
    existingKeywords: run.input.existing_keywords,
    clients,
    config: resolveConfig(presets),
  };
}

/**
 * Execute one stage against the run's checkpointed state. Idempotent: a
 * duplicate invocation of an already-completed stage (SFN redrive double-fire)
 * is a no-op. On failure the stage is stamped failed and a typed error is
 * rethrown so the state machine's Retry/error handling sees the right name.
 */
export async function executeStage(
  runId: string,
  stage: StrategyStageName,
  clients: Clients,
): Promise<void> {
  const run = await StrategyRunRepo.findById(runId);
  if (run === null) throw new StrategyFatalError(`strategy run ${runId} not found`);
  if (run.status === 'completed') return;
  if (run.stages[stage]?.status === 'completed') return;

  const started = new Date();
  try {
    const state = toWorkState(run);
    const ctx = toContext(run, clients);
    const next =
      stage === 'persist_schedule'
        ? await stagePersistSchedule(state, { orgId: run.org_id })
        : await runComputeStage(stage, state, ctx);
    await StrategyRunRepo.saveStageResult(
      runId,
      stage,
      {
        candidates: next.candidates,
        below_n: next.belowN,
        rejected: next.rejected,
        seeds: next.seeds,
        stats: next.stats,
      },
      { status: 'completed', started_at: started, finished_at: new Date(), stats: {}, error: null },
    );
    if (stage === 'persist_schedule') await StrategyRunRepo.setStatus(runId, 'completed');
  } catch (err) {
    const typed = toStrategyError(err);
    await StrategyRunRepo.markStageFailed(runId, stage, {
      status: 'failed',
      started_at: started,
      finished_at: new Date(),
      stats: {},
      error: typed.message,
    }).catch(() => {});
    throw typed;
  }
}

async function runComputeStage(
  stage: Exclude<StrategyStageName, 'persist_schedule'>,
  state: StrategyWorkState,
  ctx: StageContext,
): Promise<StrategyWorkState> {
  switch (stage) {
    case 'gather':
      return stageGather(state, ctx);
    case 'enrich':
      return stageEnrich(state, ctx);
    case 'triage':
      return stageTriage(state, ctx);
    case 'serp_fetch':
      return stageSerpFetch(state, ctx);
    case 'plan':
      return stagePlan(state, ctx);
  }
}

/** Local/dev/CLI runner: same stages, sequentially, resuming past completed ones. */
export async function runLocalStrategy(runId: string, clients?: Clients): Promise<void> {
  const resolved = clients ?? (await getStrategyClients());
  for (const stage of STRATEGY_STAGES) {
    await executeStage(runId, stage, resolved);
  }
}

/** EventBridge failure handler: stamp org + run failed after the execution dies. */
export async function markRunFailed(runId: string, orgId: string): Promise<void> {
  await OrgRepo.setStrategyStatus(orgId, 'failed');
  await StrategyRunRepo.setStatus(runId, 'failed');
}
