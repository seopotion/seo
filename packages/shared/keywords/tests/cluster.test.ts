import { describe, expect, it } from 'vitest';
import { clusterCandidates } from '../src/cluster';
import type { WorkingCandidate } from '../src/types';

const cand = (keyword: string, search_volume: number | null): WorkingCandidate => ({
  keyword,
  normalized: keyword.toLowerCase(),
  source: 'keyword_ideas',
  source_context: null,
  search_volume,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  relevance_score: null,
  opportunity_score: null,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
  serp_competitors: null,
});

describe('clusterCandidates', () => {
  it('keeps the highest-volume head and rejects near-duplicate members', () => {
    const { survivors, rejected } = clusterCandidates(
      [
        cand('best running shoes', 100),
        cand('best running shoes for men', 500),
        cand('yoga mat guide', 50),
      ],
      0.6,
    );
    expect(survivors.map((c) => c.keyword).sort()).toEqual([
      'best running shoes for men',
      'yoga mat guide',
    ]);
    expect(rejected[0]!.keyword).toBe('best running shoes');
    expect(rejected[0]!.rejection_reason).toBe('clustered_duplicate');
  });

  it('does not cluster below the Jaccard threshold', () => {
    const { survivors } = clusterCandidates(
      [cand('cheap flights europe', 100), cand('luxury hotels asia', 100)],
      0.6,
    );
    expect(survivors).toHaveLength(2);
  });
});
