import type { RejectionReason } from '@shared/schemas';
import { resolveConfig } from './config';
import { PLAN_MAX_CANDIDATES } from './plan-contract';
import {
  emptyWorkState,
  type StageContext,
  stageEnrich,
  stageGather,
  stagePlan,
  stageSerpFetch,
  stageTriage,
  toEnriched,
} from './stages';
import type { PipelineInput, PipelineResult, PipelineStats } from './types';

const EMPTY_REASON_COUNTS: Record<RejectionReason, number> = {
  brand_navigation: 0,
  competitor_brand: 0,
  clustered_duplicate: 0,
  difficulty_ceiling: 0,
  relevance_floor: 0,
  serp_intent: 0,
  serp_authority: 0,
  serp_locality: 0,
  serp_duplicate: 0,
  topic_duplicate: 0,
};

function assertSerpTopN(serpTopN: number): void {
  if (!Number.isInteger(serpTopN) || serpTopN < 0) {
    throw new Error(`serpTopN must be a non-negative integer; received ${String(serpTopN)}`);
  }
  if (serpTopN > PLAN_MAX_CANDIDATES) {
    throw new Error(`serpTopN ${serpTopN} exceeds the plan-call maximum of ${PLAN_MAX_CANDIDATES}`);
  }
}

/**
 * Dry-run / CLI entrypoint: the five stages run sequentially in one process,
 * with no checkpointing between them. The Step Functions orchestrator (#56
 * rearchitect) calls the same stage functions individually, persisting
 * `StrategyWorkState` between invocations instead.
 */
export async function runKeywordPipeline(input: PipelineInput): Promise<PipelineResult> {
  const config = resolveConfig(input.presets, input.config);
  assertSerpTopN(config.serpTopN);

  const ctx: StageContext = {
    orgId: input.orgId,
    websiteUrl: input.websiteUrl,
    presets: input.presets,
    competitors: input.competitors,
    existingKeywords: [...input.existingKeywords, ...input.existingArticleKeywords],
    clients: input.clients,
    config,
    log: input.onProgress,
  };

  let state = emptyWorkState();
  state = await stageGather(state, ctx);
  state = await stageEnrich(state, ctx);
  state = await stageTriage(state, ctx);
  state = await stageSerpFetch(state, ctx);
  state = await stagePlan(state, ctx);

  // 11 assemble (stable order: accepted, below-N scored, then rejected)
  const all = [...state.candidates, ...state.belowN, ...state.rejected];
  const rejectedByReason = { ...EMPTY_REASON_COUNTS };
  for (const c of state.rejected) if (c.rejection_reason) rejectedByReason[c.rejection_reason]++;

  const stats: PipelineStats = {
    gathered: state.stats.gathered as number,
    seeds: state.seeds,
    gatheredBySource: state.stats.gatheredBySource as PipelineStats['gatheredBySource'],
    afterDedupe: state.stats.afterDedupe as number,
    afterBrandNav: state.stats.afterBrandNav as number,
    afterCeiling: state.stats.afterCeiling as number,
    scored: state.stats.scored as number,
    afterRelevanceFloor: state.stats.afterRelevanceFloor as number,
    serpChecked: state.stats.serpChecked as number,
    serpFetched: state.stats.serpFetched as number,
    authorityRejected: state.stats.authorityRejected as number,
    serpUnvalidated: state.stats.serpUnvalidated as number,
    serpValidated: state.candidates.length,
    accepted: state.candidates.length,
    rejectedByReason,
    relevance: state.stats.relevance as PipelineStats['relevance'],
    plan: state.stats.plan as PipelineStats['plan'],
  };

  return {
    candidates: all.map((c) => toEnriched(c, input.orgId)),
    stats,
  };
}
