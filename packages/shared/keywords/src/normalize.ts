import type { KeywordMetric } from '@shared/providers';
import { type CandidateSource, normalizeKeyword } from '@shared/schemas';
import type { WorkingCandidate } from './types';

export function toWorking(
  metric: KeywordMetric,
  source: CandidateSource,
  context: string | null,
): WorkingCandidate {
  return {
    keyword: metric.keyword,
    normalized: normalizeKeyword(metric.keyword),
    source,
    source_context: context,
    core_keyword: metric.core_keyword ?? null,
    category_ids: metric.category_ids ?? [],
    topic_cluster_id: null,
    topic_cluster_label: null,
    topic_role: null,
    topic_content_focus: null,
    topic_primary_keyword: null,
    search_volume: metric.search_volume,
    difficulty: metric.difficulty,
    cpc: metric.cpc,
    competition: metric.competition,
    trend: metric.trend,
    intent: metric.intent,
    relevance_score: null,
    opportunity_score: null,
    article_type: null,
    rejection_reason: null,
    status: 'candidate',
    serp_competitors: null,
    serp_validated: false,
  };
}

function richness(c: WorkingCandidate): number {
  const fields = [c.search_volume, c.difficulty, c.cpc, c.competition, c.trend, c.intent];
  return fields.filter((v) => v !== null).length;
}

/** One record per normalized keyword; the richest wins, ties keep first seen. */
export function dedupe(candidates: WorkingCandidate[]): WorkingCandidate[] {
  const best = new Map<string, WorkingCandidate>();
  for (const c of candidates) {
    const existing = best.get(c.normalized);
    if (!existing || richness(c) > richness(existing)) best.set(c.normalized, c);
  }
  return [...best.values()];
}
