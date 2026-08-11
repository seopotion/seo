import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { applyRelevance, scoreCandidates } from '../src/score';
import type { WorkingCandidate } from '../src/types';

const config = { ...DEFAULT_CONFIG, locationName: 'United States', languageName: 'English' };

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: ['t'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: {
      article_style: '',
      internal_links_count: 0,
      table_of_contents: true,
      llm_instructions: '',
    },
    engagement: { image_style: '', youtube_videos: true },
    publishing: { auto_publish: false },
  },
} satisfies SetupPresets;

const cand = (over: Partial<WorkingCandidate>): WorkingCandidate => ({
  keyword: 'dog food',
  normalized: 'dog food',
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
  serp_competitors: null,
  serp_validated: false,
  ...over,
});

const llmReturning = (text: string): LlmClient => ({
  complete: vi.fn().mockResolvedValue({
    text,
    model: 'm',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
  }),
});

describe('applyRelevance', () => {
  it('sets relevance_score from the LLM response', async () => {
    const llm = llmReturning('{"scores":[{"keyword":"dog food","relevance":0.8}]}');
    const { candidates, coverage } = await applyRelevance([cand({})], { llm, presets });
    expect(candidates[0]!.relevance_score).toBe(0.8);
    expect(coverage).toEqual({ sent: 1, returned: 1, zero: 0 });
  });

  it('reports keywords the LLM skipped, which keep the 0 seed', async () => {
    const llm = llmReturning('{"scores":[{"keyword":"dog food","relevance":0.8}]}');
    const { candidates, coverage } = await applyRelevance(
      [cand({}), cand({ keyword: 'cat food', normalized: 'cat food' })],
      { llm, presets },
    );
    expect(candidates[1]!.relevance_score).toBe(0);
    expect(coverage).toEqual({ sent: 2, returned: 1, zero: 1 });
  });

  it('does not call the LLM for an empty batch', async () => {
    const llm = llmReturning('{}');
    const { coverage } = await applyRelevance([], { llm, presets });
    expect(llm.complete).not.toHaveBeenCalled();
    expect(coverage).toEqual({ sent: 0, returned: 0, zero: 0 });
  });
});

describe('scoreCandidates', () => {
  it('computes a bounded 0..100 score from the weighted formula', () => {
    const [out] = scoreCandidates(
      // KD 1, not 0: at this volume a 0 reads as missing data and scores neutral.
      [cand({ search_volume: 10_000, difficulty: 1, trend: 1, relevance_score: 1 })],
      { cannibalSet: new Set(), config },
    );
    // volume=1, ease=0.99, trend=1, relevance=1, cannibal absent -> full score
    expect(out!.opportunity_score).toBe(100);
  });

  it('penalizes cannibalization', () => {
    const base = cand({
      search_volume: 100,
      difficulty: 20,
      relevance_score: 0.5,
      normalized: 'dog food',
    });
    const [clean] = scoreCandidates([base], { cannibalSet: new Set(), config });
    const [hit] = scoreCandidates([base], { cannibalSet: new Set(['dog food']), config });
    expect(hit!.opportunity_score!).toBeLessThan(clean!.opportunity_score!);
  });

  // DataForSEO reports difficulty 0 both for genuinely trivial keywords and for
  // keywords it has no KD data on; volume is the tell (#211).
  describe('difficulty 0', () => {
    // Volume feeds the score directly, so every comparison holds it fixed and
    // varies only `difficulty`.
    const scoreAt = (difficulty: number | null, search_volume: number): number => {
      const [out] = scoreCandidates([cand({ relevance_score: 0, difficulty, search_volume })], {
        cannibalSet: new Set(),
        config,
      });
      return out!.opportunity_score as number;
    };

    it('scores KD 0 at high volume like a null KD — both mean "unknown"', () => {
      expect(scoreAt(0, 5000)).toBe(scoreAt(null, 5000));
    });

    it('keeps KD 0 at low volume at maximum ease — plausible long-tail', () => {
      expect(scoreAt(0, 50)).toBeGreaterThan(scoreAt(null, 50));
    });

    it('treats the volume threshold as exclusive', () => {
      expect(scoreAt(0, 1000)).toBeGreaterThan(scoreAt(null, 1000)); // still max ease
      expect(scoreAt(0, 1001)).toBe(scoreAt(null, 1001)); // unknown
    });

    it('leaves a real difficulty untouched at any volume', () => {
      // KD 40 -> ease 0.6: above the 0.5 an unknown KD gets, below the 1.0 a
      // genuine long-tail KD 0 keeps.
      expect(scoreAt(40, 5000)).toBeGreaterThan(scoreAt(0, 5000));
      expect(scoreAt(40, 50)).toBeLessThan(scoreAt(0, 50));
    });
  });

  it('uses neutral 0.5 for null trend/difficulty and 0 for null volume', () => {
    const [out] = scoreCandidates([cand({ relevance_score: 0 })], {
      cannibalSet: new Set(),
      config,
    });
    // relevance 0, volume 0, ease 0.5, trend 0.5, cannibal 0 ->
    // 100*(0.2*0.5 + 0.1*0.5 + 0.05*1) = 100*(0.1+0.05+0.05)=20
    expect(out!.opportunity_score).toBe(20);
  });
});
