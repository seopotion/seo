import { describe, expect, it } from 'vitest';
import { brandNavFilter } from '../src/filters';
import type { WorkingCandidate } from '../src/types';

const cand = (keyword: string): WorkingCandidate => ({
  keyword,
  normalized: keyword.toLowerCase(),
  source: 'keyword_ideas',
  source_context: null,
  search_volume: null,
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
});

describe('brandNavFilter', () => {
  const opts = { orgName: 'Acme Robotics', websiteUrl: 'https://acmerobotics.io' };

  it('rejects brand-name and domain-label matches', () => {
    const { survivors, rejected } = brandNavFilter(
      [cand('acme robotics reviews'), cand('acmerobotics login'), cand('robot vacuum guide')],
      opts,
    );
    expect(survivors.map((c) => c.keyword)).toEqual(['robot vacuum guide']);
    expect(rejected).toHaveLength(2);
    expect(rejected[0]!.rejection_reason).toBe('brand_navigation');
    expect(rejected[0]!.status).toBe('rejected');
  });

  it('rejects navigation phrases', () => {
    const { survivors } = brandNavFilter([cand('best robot pricing'), cand('sign in page')], opts);
    expect(survivors).toHaveLength(0);
  });

  it('keeps unrelated keywords', () => {
    const { survivors } = brandNavFilter([cand('how to clean floors')], opts);
    expect(survivors).toHaveLength(1);
  });

  it('does not reject keywords that merely contain the domain label as a substring', () => {
    const { survivors } = brandNavFilter([cand('good vacuum guide')], {
      orgName: 'GoShop',
      websiteUrl: 'https://go.com',
    });
    expect(survivors).toHaveLength(1);
  });
});
