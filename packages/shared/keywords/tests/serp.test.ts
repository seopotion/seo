import type { DataForSeoClient, LlmClient, SerpResult } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { validateSerp } from '../src/serp';
import type { WorkingCandidate } from '../src/types';

const config = {
  ...DEFAULT_CONFIG,
  serpTopK: 4,
  authorityThreshold: 0.5,
  duplicateSerpOverlap: 0.6,
  locationName: 'United States',
  languageName: 'English',
};
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

const serp = (domains: string[]): SerpResult[] =>
  domains.map((d, i) => ({ rank: i + 1, url: `https://${d}/p${i}`, domain: d, title: `t${i}` }));

const okLlm = (): LlmClient => ({
  complete: vi.fn().mockResolvedValue({
    text: '{"intentSuitable":true,"localitySuitable":true,"reason":null}',
    model: 'm',
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
  }),
});

it('rejects authority-dominated SERPs deterministically (no LLM call)', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi
      .fn()
      .mockResolvedValue(serp(['wikipedia.org', 'amazon.com', 'blogx.com', 'blogy.com'])),
  } as unknown as DataForSeoClient;
  const llm = okLlm();
  const { accepted, rejected } = await validateSerp([cand('k')], {
    dataForSeo,
    llm,
    presets,
    config,
  });
  expect(accepted).toHaveLength(0);
  expect(rejected[0]!.rejection_reason).toBe('serp_authority');
  expect(llm.complete).not.toHaveBeenCalled();
});

it('rejects a duplicate SERP against an already-accepted candidate', async () => {
  const shared = serp(['a.com', 'b.com', 'c.com', 'd.com']);
  const dataForSeo = {
    serpGoogleOrganic: vi.fn().mockResolvedValueOnce(shared).mockResolvedValueOnce(shared),
  } as unknown as DataForSeoClient;
  const { accepted, rejected } = await validateSerp([cand('first'), cand('second')], {
    dataForSeo,
    llm: okLlm(),
    presets,
    config,
  });
  expect(accepted.map((c) => c.keyword)).toEqual(['first']);
  expect(rejected[0]!.rejection_reason).toBe('serp_duplicate');
});

it('uses the LLM to reject unsuitable intent', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi
      .fn()
      .mockResolvedValue(serp(['blogx.com', 'blogy.com', 'blogz.com', 'blogw.com'])),
  } as unknown as DataForSeoClient;
  const llm: LlmClient = {
    complete: vi.fn().mockResolvedValue({
      text: '{"intentSuitable":false,"localitySuitable":true,"reason":"transactional"}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  };
  const { rejected } = await validateSerp([cand('k')], { dataForSeo, llm, presets, config });
  expect(rejected[0]!.rejection_reason).toBe('serp_intent');
});

it('fetches SERPs concurrently, but preserves order and dedup semantics', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const shared = serp(['a.com', 'b.com', 'c.com', 'd.com']);
  const dataForSeo = {
    // Distinct SERP per keyword except 'dup', which mirrors 'first' so it trips
    // the sequential duplicate check — proving Phase 2 stays ordered.
    serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return keyword === 'first' || keyword === 'dup' ? shared : serp([`${keyword}.com`]);
    }),
  } as unknown as DataForSeoClient;

  const cands = ['first', 'k2', 'k3', 'dup'].map(cand);
  const { accepted, rejected } = await validateSerp(cands, {
    dataForSeo,
    llm: okLlm(),
    presets,
    config,
  });

  expect(maxInFlight).toBeGreaterThan(1); // ran in parallel
  expect(accepted.map((c) => c.keyword)).toEqual(['first', 'k2', 'k3']);
  expect(rejected.map((c) => c.rejection_reason)).toEqual(['serp_duplicate']);
});

it('accepts a clean SERP', async () => {
  const dataForSeo = {
    serpGoogleOrganic: vi
      .fn()
      .mockResolvedValue(serp(['blogx.com', 'blogy.com', 'blogz.com', 'blogw.com'])),
  } as unknown as DataForSeoClient;
  const { accepted } = await validateSerp([cand('k')], {
    dataForSeo,
    llm: okLlm(),
    presets,
    config,
  });
  expect(accepted).toHaveLength(1);
});
