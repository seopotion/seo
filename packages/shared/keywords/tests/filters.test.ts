import type { DataForSeoClient } from '@shared/providers';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { applyDifficultyCeiling, brandNavFilter, fillDifficulty } from '../src/filters';
import type { WorkingCandidate } from '../src/types';

const cand = (keyword: string): WorkingCandidate => ({
  keyword,
  normalized: keyword.toLowerCase(),
  source: 'keyword_ideas',
  source_context: null,
  core_keyword: null,
  category_ids: [],
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
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
  serp_competitors: null,
  serp_validated: false,
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

const withDiff = (keyword: string, difficulty: number | null): WorkingCandidate => ({
  ...cand(keyword),
  difficulty,
});

const config = { ...DEFAULT_CONFIG, locationName: 'United States', languageName: 'English' };

describe('fillDifficulty', () => {
  it('queries only the missing-difficulty subset and merges results', async () => {
    const bulk = vi.fn().mockResolvedValue([
      {
        keyword: 'a',
        difficulty: 30,
        search_volume: null,
        cpc: null,
        competition: null,
        trend: null,
        intent: null,
      },
    ]);
    const dataForSeo = { bulkKeywordDifficulty: bulk } as unknown as DataForSeoClient;

    const out = await fillDifficulty([withDiff('a', null), withDiff('b', 20)], {
      dataForSeo,
      config,
    });

    expect(bulk).toHaveBeenCalledTimes(1);
    expect(bulk.mock.calls[0]![0].keywords).toEqual(['a']);
    expect(out.find((c) => c.keyword === 'a')!.difficulty).toBe(30);
    expect(out.find((c) => c.keyword === 'b')!.difficulty).toBe(20);
  });

  it('does not call the provider when nothing is missing', async () => {
    const bulk = vi.fn();
    const dataForSeo = { bulkKeywordDifficulty: bulk } as unknown as DataForSeoClient;
    await fillDifficulty([withDiff('a', 10)], { dataForSeo, config });
    expect(bulk).not.toHaveBeenCalled();
  });
});

describe('applyDifficultyCeiling', () => {
  it('rejects above the ceiling, keeps <=45 and null', () => {
    const { survivors, rejected } = applyDifficultyCeiling(
      [withDiff('keep', 45), withDiff('drop', 46), withDiff('unknown', null)],
      45,
    );
    expect(survivors.map((c) => c.keyword).sort()).toEqual(['keep', 'unknown']);
    expect(rejected[0]!.rejection_reason).toBe('difficulty_ceiling');
  });
});
