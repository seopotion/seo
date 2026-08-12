import {
  CANDIDATE_SOURCES,
  type CandidateSource,
  normalizeKeyword,
  type RejectionReason,
} from '@shared/schemas';
import { classifyCandidates } from './classify';
import { resolveConfig } from './config';
import { applyDifficultyCeiling, brandNavFilter, fillDifficulty, reject } from './filters';
import { gatherCandidates } from './gather';
import { dedupe } from './normalize';
import { applyRelevance, scoreCandidates } from './score';
import { validateSerp } from './serp';
import {
  assignTopicClusters,
  type MaterializedTopicTarget,
  materializeTopicClusters,
  TOPIC_CLUSTER_MAX_CANDIDATES,
  type TopicClusterResult,
} from './topic-clusters';
import type { EnrichedCandidate, PipelineInput, PipelineResult, WorkingCandidate } from './types';

const EMPTY_REASON_COUNTS: Record<RejectionReason, number> = {
  brand_navigation: 0,
  clustered_duplicate: 0,
  difficulty_ceiling: 0,
  relevance_floor: 0,
  serp_intent: 0,
  serp_authority: 0,
  serp_locality: 0,
  serp_duplicate: 0,
  topic_duplicate: 0,
};

const EMPTY_SOURCE_COUNTS = Object.fromEntries(CANDIDATE_SOURCES.map((s) => [s, 0])) as Record<
  CandidateSource,
  number
>;

function toEnriched(c: WorkingCandidate, orgId: string): EnrichedCandidate {
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

function assertSerpTopN(serpTopN: number): void {
  if (!Number.isInteger(serpTopN) || serpTopN < 0) {
    throw new Error(`serpTopN must be a non-negative integer; received ${String(serpTopN)}`);
  }
  if (serpTopN > TOPIC_CLUSTER_MAX_CANDIDATES) {
    throw new Error(
      `serpTopN ${serpTopN} exceeds the topic-clustering maximum of ${TOPIC_CLUSTER_MAX_CANDIDATES}`,
    );
  }
}

function attachTopicMetadata(
  candidate: WorkingCandidate,
  target: MaterializedTopicTarget,
): WorkingCandidate {
  return {
    ...candidate,
    topic_cluster_id: target.topic_cluster_id,
    topic_cluster_label: target.topic_cluster_label,
    topic_role: target.topic_role,
    topic_content_focus: target.content_focus,
    topic_primary_keyword: target.primary_keyword,
  };
}

function rankKey(a: WorkingCandidate, b: WorkingCandidate): number {
  return (
    (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0) ||
    a.normalized.localeCompare(b.normalized)
  );
}

/**
 * Abort the run when a stage's model answered too little of its batch. Both
 * guarded stages degrade INVISIBLY and in opposite directions — an unscored
 * relevance pool ranks on volume + ease alone, an unjudged SERP batch fails
 * every keyword open — so each one produces a full, plausible-looking 30-day
 * plan built on nothing. Throwing hands the run to the worker's catch, which
 * marks the org failed and rethrows so SQS redelivers; a degraded plan silently
 * marked `completed` is the outcome this exists to prevent (#211).
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

export async function runKeywordPipeline(input: PipelineInput): Promise<PipelineResult> {
  const config = resolveConfig(input.presets, input.config);
  assertSerpTopN(config.serpTopN);
  const progress = input.onProgress ?? (() => {});
  const minCoverage = config.minLlmCoverage;
  const rejected: WorkingCandidate[] = [];

  // 1 gather → 2 dedupe
  progress('gather');
  const raw = await gatherCandidates(
    {
      websiteUrl: input.websiteUrl,
      competitors: input.competitors,
      presets: input.presets,
      clients: input.clients,
    },
    config,
  );
  const gathered = raw.candidates.length;
  const gatheredBySource = { ...EMPTY_SOURCE_COUNTS };
  for (const c of raw.candidates) gatheredBySource[c.source]++;
  const deduped = dedupe(raw.candidates);

  // 3 brand/nav
  const brand = brandNavFilter(deduped, {
    orgName: input.presets.business.name,
    websiteUrl: input.websiteUrl,
  });
  rejected.push(...brand.rejected);

  // 4 fill difficulty → 5 ceiling
  progress('fill_difficulty', { candidates: brand.survivors.length });
  const filled = await fillDifficulty(brand.survivors, {
    dataForSeo: input.clients.dataForSeo,
    config,
  });
  const ceiling = applyDifficultyCeiling(filled, config.difficultyCeiling);
  rejected.push(...ceiling.rejected);

  // 6 relevance → 7 score
  progress('relevance', { candidates: ceiling.survivors.length });
  const relevance = await applyRelevance(ceiling.survivors, {
    llm: input.clients.llm,
    presets: input.presets,
    model: config.models.relevance,
  });
  assertCoverage('relevance', relevance.coverage.sent, relevance.coverage.returned, minCoverage);
  const cannibalSet = new Set(
    [...input.existingKeywords, ...input.existingArticleKeywords].map(normalizeKeyword),
  );
  const scored = scoreCandidates(relevance.candidates, { cannibalSet, config });

  // 7b relevance floor — before the split, so a keyword the model saw no
  // connection to never consumes one of the serpTopN validation slots. A NULL
  // score is not a zero: it means the model never judged the keyword, and
  // treating the two alike is what let an empty response reject the entire pool
  // and still report success (#211). Unscored candidates survive the floor and
  // simply rank lower, since scoreCandidates weights a null relevance as 0.
  const relevant: WorkingCandidate[] = [];
  for (const c of scored) {
    const score = c.relevance_score;
    if (score !== null && score <= config.relevanceFloor)
      rejected.push(reject(c, 'relevance_floor'));
    else relevant.push(c);
  }

  // 8 rank + split top-N
  const ranked = [...relevant].sort(rankKey);
  const topN = ranked.slice(0, config.serpTopN);
  const belowN = ranked.slice(config.serpTopN);

  // 9 SERP validate → 10 classify
  const serp = await validateSerp(topN, {
    dataForSeo: input.clients.dataForSeo,
    llm: input.clients.llm,
    presets: input.presets,
    config,
    onProgress: progress,
  });
  rejected.push(...serp.rejected);
  assertCoverage('SERP judge', serp.coverage.sent, serp.coverage.returned, minCoverage);
  progress('classify', { candidates: serp.accepted.length });
  // Classify is deliberately NOT guarded: an unclassified keyword becomes
  // `other`, which weakens its content brief but never puts a keyword on the
  // plan that does not belong there. Its coverage counters are the report;
  // they are not grounds to fail a run.
  const classified = await classifyCandidates(serp.accepted, {
    llm: input.clients.llm,
    presets: input.presets,
    model: config.models.classify,
  });

  // A pool that gathered keywords but accepted none is not a valid empty plan —
  // it is a stage that failed in a way the coverage guards did not name. The
  // worker would otherwise mark the org `completed` with nothing scheduled.
  if (gathered > 0 && classified.candidates.length === 0) {
    throw new Error(
      `strategy aborted: gathered ${gathered} keywords but accepted 0, so the plan would be ` +
        'empty. Check rejectedByReason for which stage consumed them.',
    );
  }

  let topicResult: TopicClusterResult = { clusters: [] };
  if (classified.candidates.length > 0) {
    progress('topic_clustering', { candidates: classified.candidates.length });
    topicResult = await assignTopicClusters(
      classified.candidates,
      {
        businessName: input.presets.business.name,
        businessDescription: input.presets.business.description,
        targetAudience: input.presets.audience.target,
        language: input.presets.business.language,
        country: input.presets.business.country,
      },
      input.clients.llm,
      config.models.topicClusters,
    );
  }
  const materialized = materializeTopicClusters(classified.candidates, topicResult);
  const accepted: WorkingCandidate[] = [];
  const topicDuplicates: WorkingCandidate[] = [];
  for (const target of materialized.targets) {
    accepted.push(
      attachTopicMetadata(classified.candidates[target.primary_index] as WorkingCandidate, target),
    );
    for (const memberIndex of target.member_indices) {
      if (memberIndex === target.primary_index) continue;
      topicDuplicates.push(
        reject(
          attachTopicMetadata(classified.candidates[memberIndex] as WorkingCandidate, target),
          'topic_duplicate',
        ),
      );
    }
  }
  rejected.push(...topicDuplicates);

  // 11 assemble (stable order: materialized targets, below-N scored, then rejected)
  const all: WorkingCandidate[] = [...accepted, ...belowN, ...rejected];
  const rejectedByReason = { ...EMPTY_REASON_COUNTS };
  for (const c of rejected) if (c.rejection_reason) rejectedByReason[c.rejection_reason]++;

  return {
    candidates: all.map((c) => toEnriched(c, input.orgId)),
    stats: {
      gathered,
      seeds: raw.seeds,
      gatheredBySource,
      afterDedupe: deduped.length,
      afterBrandNav: brand.survivors.length,
      afterCeiling: ceiling.survivors.length,
      scored: scored.length,
      afterRelevanceFloor: relevant.length,
      serpChecked: topN.length,
      serpValidated: serp.accepted.length,
      accepted: accepted.length,
      topicClustering: {
        candidates: classified.candidates.length,
        clusters: topicResult.clusters.length,
        targets: materialized.targets.length,
        duplicates: materialized.duplicates.length,
        pillars: materialized.targets.filter((target) => target.topic_role === 'pillar').length,
        supports: materialized.targets.filter((target) => target.topic_role === 'support').length,
      },
      rejectedByReason,
      relevance: relevance.coverage,
      judgment: serp.coverage,
      classification: classified.coverage,
    },
  };
}
