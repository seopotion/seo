import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it, vi } from 'vitest';
import { classifyCandidates } from '../src/classify';
import type { WorkingCandidate } from '../src/types';

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: 't', competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '' },
  },
} satisfies SetupPresets;

const cand = (keyword: string): WorkingCandidate => ({
  keyword,
  normalized: keyword,
  source: 'keyword_ideas',
  source_context: null,
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  relevance_score: null,
  opportunity_score: 50,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
  serp_competitors: null,
});

describe('classifyCandidates', () => {
  it('assigns article_type from the LLM response', async () => {
    const llm: LlmClient = {
      complete: vi.fn().mockResolvedValue({
        text: '{"types":[{"keyword":"how to bathe a dog","article_type":"how_to_guide"}]}',
        model: 'm',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
      }),
    };
    const [out] = await classifyCandidates([cand('how to bathe a dog')], { llm, presets });
    expect(out!.article_type).toBe('how_to_guide');
  });

  it('skips the LLM for an empty batch', async () => {
    const llm: LlmClient = { complete: vi.fn() };
    await classifyCandidates([], { llm, presets });
    expect(llm.complete).not.toHaveBeenCalled();
  });
});
