import { getDataForSeoClient } from '../clients/providers';
import type { KeywordMetric } from '../schemas/keywords';

/**
 * Keyword-research provider core, extracted mechanically from the customer
 * `POST /keywords/research` handler (epic #150 Phase 1) so the admin research
 * route reuses it without touching customer behavior. Callers own the gating
 * (customer: owned + paid; admin: none) and the `DataForSeoError` -> 502 map.
 */
export const RESEARCH_LIMIT = 20;

/** Normalize provider metrics at the API boundary: volume/difficulty are ints (#99). */
export function normMetric(m: KeywordMetric): KeywordMetric {
  return {
    ...m,
    search_volume: m.search_volume === null ? null : Math.round(m.search_volume),
    difficulty: m.difficulty === null ? null : Math.round(m.difficulty),
  };
}

/** Seed metrics + up to RESEARCH_LIMIT similar ideas (seed deduped out). */
export async function researchKeyword(
  seed: string,
  loc: { locationName?: string; languageName?: string },
): Promise<{ seed: KeywordMetric; similar: KeywordMetric[] }> {
  const df = await getDataForSeoClient();
  const [seedMetrics, ideas] = await Promise.all([
    df.bulkKeywordDifficulty({ keywords: [seed], ...loc }),
    df.keywordIdeas({ keywords: [seed], limit: RESEARCH_LIMIT, ...loc }),
  ]);
  const seedMetric = seedMetrics[0] ?? {
    keyword: seed,
    search_volume: null,
    difficulty: null,
    cpc: null,
    competition: null,
    trend: null,
    intent: null,
  };
  const norm = seed.trim().toLowerCase();
  const similar = ideas
    .filter((m) => m.keyword.trim().toLowerCase() !== norm)
    .slice(0, RESEARCH_LIMIT)
    .map(normMetric);
  return { seed: normMetric(seedMetric), similar };
}
