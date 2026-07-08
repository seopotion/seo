import { normalizeKeyword, type RejectionReason } from '@shared/schemas';
import { classifyCandidates } from './classify';
import { clusterCandidates } from './cluster';
import { resolveConfig } from './config';
import { applyDifficultyCeiling, brandNavFilter, fillDifficulty } from './filters';
import { gatherCandidates } from './gather';
import { dedupe } from './normalize';
import { applyRelevance, scoreCandidates } from './score';
import { validateSerp } from './serp';
import type { EnrichedCandidate, PipelineInput, PipelineResult, WorkingCandidate } from './types';

const EMPTY_REASON_COUNTS: Record<RejectionReason, number> = {
  brand_navigation: 0,
  clustered_duplicate: 0,
  difficulty_ceiling: 0,
  serp_intent: 0,
  serp_authority: 0,
  serp_locality: 0,
  serp_duplicate: 0,
};

function toEnriched(c: WorkingCandidate, orgId: string): EnrichedCandidate {
  return {
    org_id: orgId,
    keyword: c.keyword,
    source: c.source,
    source_context: c.source_context,
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
  };
}

function rankKey(a: WorkingCandidate, b: WorkingCandidate): number {
  return (
    (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0) ||
    a.normalized.localeCompare(b.normalized)
  );
}

export async function runKeywordPipeline(input: PipelineInput): Promise<PipelineResult> {
  const config = resolveConfig(input.presets, input.config);
  const rejected: WorkingCandidate[] = [];

  // 1 gather → 2 dedupe
  const raw = await gatherCandidates(
    {
      websiteUrl: input.websiteUrl,
      competitors: input.competitors,
      presets: input.presets,
      clients: input.clients,
    },
    config,
  );
  const gathered = raw.length;
  const deduped = dedupe(raw);

  // 3 brand/nav
  const brand = brandNavFilter(deduped, {
    orgName: input.presets.business.name,
    websiteUrl: input.websiteUrl,
  });
  rejected.push(...brand.rejected);

  // 4 cluster
  const clustered = clusterCandidates(brand.survivors, config.clusterJaccard);
  rejected.push(...clustered.rejected);

  // 5 fill difficulty → 6 ceiling
  const filled = await fillDifficulty(clustered.survivors, {
    dataForSeo: input.clients.dataForSeo,
    config,
  });
  const ceiling = applyDifficultyCeiling(filled, config.difficultyCeiling);
  rejected.push(...ceiling.rejected);

  // 7 relevance → 8 score
  const withRelevance = await applyRelevance(ceiling.survivors, {
    llm: input.clients.llm,
    presets: input.presets,
  });
  const cannibalSet = new Set(
    [...input.existingKeywords, ...input.existingArticleKeywords].map(normalizeKeyword),
  );
  const scored = scoreCandidates(withRelevance, { cannibalSet, config });

  // 9 rank + split top-N
  const ranked = [...scored].sort(rankKey);
  const topN = ranked.slice(0, config.serpTopN);
  const belowN = ranked.slice(config.serpTopN);

  // 10 SERP validate → 11 classify
  const serp = await validateSerp(topN, {
    dataForSeo: input.clients.dataForSeo,
    llm: input.clients.llm,
    presets: input.presets,
    config,
  });
  rejected.push(...serp.rejected);
  const classified = await classifyCandidates(serp.accepted, {
    llm: input.clients.llm,
    presets: input.presets,
  });

  // 12 assemble (stable order: accepted, then below-N scored, then rejected)
  const all: WorkingCandidate[] = [...classified, ...belowN, ...rejected];
  const rejectedByReason = { ...EMPTY_REASON_COUNTS };
  for (const c of rejected) if (c.rejection_reason) rejectedByReason[c.rejection_reason]++;

  return {
    candidates: all.map((c) => toEnriched(c, input.orgId)),
    stats: {
      gathered,
      afterDedupe: deduped.length,
      afterBrandNav: brand.survivors.length,
      clustered: clustered.rejected.length,
      afterCeiling: ceiling.survivors.length,
      scored: scored.length,
      serpValidated: topN.length,
      accepted: classified.length,
      rejectedByReason,
    },
  };
}
