import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { applyRelevance, scoreCandidates } from '../src/score';
import type { WorkingCandidate } from '../src/types';

const config = { ...DEFAULT_CONFIG, locationName: 'United States', languageName: 'English' };

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: 't', competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '' },
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
    const [out] = await applyRelevance([cand({})], { llm, presets });
    expect(out!.relevance_score).toBe(0.8);
  });

  it('does not call the LLM for an empty batch', async () => {
    const llm = llmReturning('{}');
    await applyRelevance([], { llm, presets });
    expect(llm.complete).not.toHaveBeenCalled();
  });
});

describe('scoreCandidates', () => {
  it('computes a bounded 0..100 score from the weighted formula', () => {
    const [out] = scoreCandidates(
      [cand({ search_volume: 10_000, difficulty: 0, trend: 1, relevance_score: 1 })],
      { cannibalSet: new Set(), config },
    );
    // volume=1, ease=1, trend=1, relevance=1, cannibal absent -> full score
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
