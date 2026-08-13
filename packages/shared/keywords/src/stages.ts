import type { DataForSeoClient, LlmClient, LlmMessage } from '@shared/providers';
import {
  CANDIDATE_SOURCES,
  type CandidateSource,
  normalizeKeyword,
  type SetupPresets,
} from '@shared/schemas';
import { applyDifficultyCeiling, brandNavFilter, fillDifficulty, reject } from './filters';
import { gatherCandidates } from './gather';
import {
  materializePlan,
  PLAN_REPAIR_KINDS,
  type PlanCoverage,
  PlanCoverageError,
} from './materializer';
import { dedupe } from './normalize';
import { buildPlanPrompt, PlanParseError, parsePlanResponse } from './plan-contract';
import { applyRelevance, scoreCandidates } from './score';
import { validateSerp } from './serp';
import type { EnrichedCandidate, ResolvedConfig, WorkingCandidate } from './types';

const EMPTY_SOURCE_COUNTS = Object.fromEntries(CANDIDATE_SOURCES.map((s) => [s, 0])) as Record<
  CandidateSource,
  number
>;

const EMPTY_PLAN_COVERAGE: PlanCoverage = {
  finalists: 0,
  verdicts: 0,
  unjudged: 0,
  accepted: 0,
  targets: 0,
  clusters: 0,
  singletons: 0,
  duplicates: 0,
  pillars: 0,
  supports: 0,
  repaired: Object.fromEntries(PLAN_REPAIR_KINDS.map((k) => [k, 0])) as PlanCoverage['repaired'],
  repairRetried: false,
};

/** The active pool a stage transforms, plus everything a run must remember. */
export interface StrategyWorkState {
  candidates: WorkingCandidate[];
  belowN: WorkingCandidate[];
  rejected: WorkingCandidate[];
  seeds: string[];
  /** Accumulated `PipelineStats` fragments; assembled into the typed shape by the caller. */
  stats: Record<string, unknown>;
}

export interface StageContext {
  orgId: string;
  websiteUrl: string;
  presets: SetupPresets;
  competitors: string[];
  existingKeywords: string[];
  clients: { dataForSeo: DataForSeoClient; llm: LlmClient };
  config: ResolvedConfig;
  /** Called at stage entry, so a hang is attributable to the last stage logged. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

export const emptyWorkState = (): StrategyWorkState => ({
  candidates: [],
  belowN: [],
  rejected: [],
  seeds: [],
  stats: {},
});

/** Pipeline output shape — assignable to `CreateCandidateInput`. Moved from pipeline.ts. */
export function toEnriched(c: WorkingCandidate, orgId: string): EnrichedCandidate {
  return {
    org_id: orgId,
    keyword: c.keyword,
    source: c.source,
    source_context: c.source_context,
    core_keyword: c.core_keyword,
    category_ids: c.category_ids,
    topic_cluster_id: c.topic_cluster_id,
    topic_cluster_label: c.topic_cluster_label,
    topic_role: c.topic_role,
    topic_content_focus: c.topic_content_focus,
    topic_primary_keyword: c.topic_primary_keyword,
    search_volume: c.search_volume,
    difficulty: c.difficulty,
    cpc: c.cpc,
    competition: c.competition,
    trend: c.trend,
    intent: c.intent,
    relevance_score: c.relevance_score,
    opportunity_score: c.opportunity_score,
    article_type: c.article_type,
    rejection_reason: c.rejection_reason,
    status: c.status,
    serp_competitors: c.serp_competitors,
    serp_validated: c.serp_validated,
  };
}

function rankKey(a: WorkingCandidate, b: WorkingCandidate): number {
  return (
    (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0) ||
    a.normalized.localeCompare(b.normalized)
  );
}

/**
 * Abort the run when a stage's model answered too little of its batch. An
 * unscored relevance pool ranks on volume + ease alone, which degrades
 * INVISIBLY and produces a full, plausible-looking plan built on nothing.
 * Throwing hands the run to the caller's failure path (#211).
 */
function assertCoverage(stage: string, sent: number, returned: number, min: number): void {
  if (sent === 0 || min <= 0) return;
  const fraction = returned / sent;
  if (fraction >= min) return;
  throw new Error(
    `strategy aborted: the ${stage} LLM answered only ${returned} of ${sent} keywords ` +
      `(${Math.round(fraction * 100)}%, minLlmCoverage ${Math.round(min * 100)}%). ` +
      'Completing would ship a plan the model never actually judged.',
  );
}

/** Gather candidates → dedupe → brand/nav filter. */
export async function stageGather(
  state: StrategyWorkState,
  ctx: StageContext,
): Promise<StrategyWorkState> {
  ctx.log?.('gather');
  const raw = await gatherCandidates(
    {
      websiteUrl: ctx.websiteUrl,
      competitors: ctx.competitors,
      presets: ctx.presets,
      clients: ctx.clients,
    },
    ctx.config,
  );
  const gathered = raw.candidates.length;
  const gatheredBySource = { ...EMPTY_SOURCE_COUNTS };
  for (const c of raw.candidates) gatheredBySource[c.source]++;
  const deduped = dedupe(raw.candidates);
  const brand = brandNavFilter(deduped, {
    orgName: ctx.presets.business.name,
    websiteUrl: ctx.websiteUrl,
  });

  return {
    ...state,
    candidates: brand.survivors,
    seeds: raw.seeds,
    rejected: [...state.rejected, ...brand.rejected],
    stats: {
      ...state.stats,
      gathered,
      gatheredBySource,
      afterDedupe: deduped.length,
      afterBrandNav: brand.survivors.length,
    },
  };
}

/** Fill missing difficulty → apply the difficulty ceiling. */
export async function stageEnrich(
  state: StrategyWorkState,
  ctx: StageContext,
): Promise<StrategyWorkState> {
  ctx.log?.('enrich', { candidates: state.candidates.length });
  const filled = await fillDifficulty(state.candidates, {
    dataForSeo: ctx.clients.dataForSeo,
    config: ctx.config,
  });
  const ceiling = applyDifficultyCeiling(filled, ctx.config.difficultyCeiling);

  return {
    ...state,
    candidates: ceiling.survivors,
    rejected: [...state.rejected, ...ceiling.rejected],
    stats: { ...state.stats, afterCeiling: ceiling.survivors.length },
  };
}

/** Relevance score → cannibalization/opportunity score → relevance floor → rank → split at serpTopN. */
export async function stageTriage(
  state: StrategyWorkState,
  ctx: StageContext,
): Promise<StrategyWorkState> {
  ctx.log?.('triage', { candidates: state.candidates.length });
  const relevance = await applyRelevance(state.candidates, {
    llm: ctx.clients.llm,
    presets: ctx.presets,
    model: ctx.config.models.relevance,
  });
  assertCoverage(
    'relevance',
    relevance.coverage.sent,
    relevance.coverage.returned,
    ctx.config.minLlmCoverage,
  );

  const cannibalSet = new Set(ctx.existingKeywords.map(normalizeKeyword));
  const scored = scoreCandidates(relevance.candidates, { cannibalSet, config: ctx.config });

  // A NULL score means "never judged", not "scored 0" — treating the two alike
  // is what let an empty response reject the entire pool while still reporting
  // success (#211). Unscored candidates survive the floor and simply rank lower.
  const floorRejected: WorkingCandidate[] = [];
  const relevant: WorkingCandidate[] = [];
  for (const c of scored) {
    const score = c.relevance_score;
    if (score !== null && score <= ctx.config.relevanceFloor) {
      floorRejected.push(reject(c, 'relevance_floor'));
    } else {
      relevant.push(c);
    }
  }

  const ranked = [...relevant].sort(rankKey);
  const topN = ranked.slice(0, ctx.config.serpTopN);
  const belowN = ranked.slice(ctx.config.serpTopN);

  // A pool that gathered keywords but sent none through to SERP validation is
  // not a valid empty plan — it is a stage that failed in a way the coverage
  // guard did not name (#211).
  const gathered = (state.stats.gathered as number | undefined) ?? 0;
  if (gathered > 0 && topN.length === 0) {
    throw new Error(
      `strategy aborted: gathered ${gathered} keywords but 0 reached SERP validation. ` +
        'Check rejectedByReason for which stage consumed them.',
    );
  }

  return {
    ...state,
    candidates: topN,
    belowN,
    rejected: [...state.rejected, ...floorRejected],
    stats: {
      ...state.stats,
      scored: scored.length,
      afterRelevanceFloor: relevant.length,
      serpChecked: topN.length,
      relevance: relevance.coverage,
    },
  };
}

/** Concurrent SERP fetch + authority filter (no LLM call). */
export async function stageSerpFetch(
  state: StrategyWorkState,
  ctx: StageContext,
): Promise<StrategyWorkState> {
  ctx.log?.('serp_fetch', { candidates: state.candidates.length });
  const serpFetched = state.candidates.length;
  const { accepted, rejected } = await validateSerp(state.candidates, {
    dataForSeo: ctx.clients.dataForSeo,
    config: ctx.config,
  });

  // A pool that reached SERP fetch but had every candidate authority-rejected
  // is not a valid empty plan — it is a stage that consumed the whole pool
  // silently. `stagePlan`'s own empty-finalist-pool guard never sees this
  // case, since it early-returns before ever calling the LLM (#211).
  if (serpFetched > 0 && accepted.length === 0) {
    throw new Error(
      `strategy aborted: ${serpFetched} candidates reached SERP fetch but 0 survived the ` +
        'authority filter, so the plan would be empty. Check rejectedByReason.serp_authority.',
    );
  }

  return {
    ...state,
    candidates: accepted,
    rejected: [...state.rejected, ...rejected],
    stats: { ...state.stats, serpFetched, authorityRejected: rejected.length },
  };
}

function repairMessages(
  original: LlmMessage[],
  previousText: string,
  errorMessage: string,
): LlmMessage[] {
  return [
    ...original,
    { role: 'assistant', content: previousText },
    {
      role: 'user',
      content: `Your previous response was rejected: ${errorMessage}. Return the complete corrected JSON — nothing else.`,
    },
  ];
}

/**
 * The single plan call: judges intent/locality/article-type and groups
 * candidates into content targets, replacing the old SERP-judge + classify +
 * topic-cluster calls (#56 rearchitect). One repair retry on a parse or
 * coverage failure; a second failure propagates.
 */
export async function stagePlan(
  state: StrategyWorkState,
  ctx: StageContext,
): Promise<StrategyWorkState> {
  ctx.log?.('plan', { candidates: state.candidates.length });

  if (state.candidates.length === 0) {
    return { ...state, candidates: [], stats: { ...state.stats, plan: EMPTY_PLAN_COVERAGE } };
  }

  const messages = buildPlanPrompt(state.candidates, ctx.presets);
  const callPlan = (msgs: LlmMessage[]) =>
    ctx.clients.llm.complete({
      messages: msgs,
      model: ctx.config.models.plan,
      temperature: 0,
      responseFormat: 'json',
    });

  const first = await callPlan(messages);

  let accepted: WorkingCandidate[];
  let rejected: WorkingCandidate[];
  let unjudged: WorkingCandidate[];
  let coverage: PlanCoverage;
  try {
    const response = parsePlanResponse(first.text);
    const result = materializePlan(state.candidates, response, ctx.config.minLlmCoverage);
    accepted = result.accepted;
    rejected = result.rejected;
    unjudged = result.unjudged;
    coverage = result.coverage;
  } catch (err) {
    if (!(err instanceof PlanParseError || err instanceof PlanCoverageError)) throw err;
    const retry = await callPlan(repairMessages(messages, first.text, err.message));
    const response = parsePlanResponse(retry.text);
    const result = materializePlan(state.candidates, response, ctx.config.minLlmCoverage);
    accepted = result.accepted;
    rejected = result.rejected;
    unjudged = result.unjudged;
    coverage = { ...result.coverage, repairRetried: true };
  }

  // A pool that reached the plan call but got NOTHING accepted is not a valid
  // empty plan — it is a stage that judged everything away. #211's stance is
  // that "gathered keywords but accepted none" is a failed stage wearing an
  // empty plan, and it must never reach the persist stage silently. This is a
  // plain Error (not PlanParseError/PlanCoverageError), fired only AFTER
  // materialization succeeds, so it does not trigger the repair retry above.
  if (state.candidates.length > 0 && accepted.length === 0) {
    throw new Error(
      `strategy aborted: ${state.candidates.length} finalists reached the plan call but 0 ` +
        'were accepted, so the plan would be empty. Check rejectedByReason / plan coverage ' +
        'for which verdict consumed them.',
    );
  }

  // Unjudged finalists are NOT fail-opened into accepted (that was the #211
  // bug) — they go to the unvalidated tier instead, `serp_validated: false`
  // keeps them unschedulable, so the result set still reconciles
  // (accepted + belowN + rejected === the finalist pool) without silently
  // losing anyone the model never got to.
  return {
    ...state,
    candidates: accepted,
    belowN: [...state.belowN, ...unjudged],
    rejected: [...state.rejected, ...rejected],
    stats: { ...state.stats, plan: coverage },
  };
}
