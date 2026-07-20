import type { DataForSeoClient, KeywordMetric, LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { gatherCandidates } from '../src/gather';

const config = { ...DEFAULT_CONFIG, locationName: 'United States', languageName: 'English' };
const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'd' },
  audience: { target: ['t'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: '', internal_links: false, llm_instructions: '' },
    engagement: { image_style: '', include_youtube_video: true },
  },
} satisfies SetupPresets;

const metric = (keyword: string): KeywordMetric => ({
  keyword,
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
});

it('fans out across site/competitors/ideas and tags provenance', async () => {
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([metric('site kw')]),
    rankedKeywords: vi.fn().mockResolvedValue([metric('comp kw')]),
    keywordIdeas: vi.fn().mockResolvedValue([metric('idea kw')]),
  } as unknown as DataForSeoClient;
  const llm = {
    complete: vi.fn().mockResolvedValue({
      text: '{"seeds":["dog food"]}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  } as unknown as LlmClient;

  const out = await gatherCandidates(
    {
      websiteUrl: 'https://acme.io',
      competitors: ['comp.com'],
      presets,
      clients: { dataForSeo, llm },
    },
    config,
  );

  expect(out.map((c) => c.source).sort()).toEqual([
    'keyword_ideas',
    'keywords_for_site',
    'ranked_keywords',
  ]);
  expect(out.find((c) => c.source === 'ranked_keywords')!.source_context).toBe('comp.com');
  expect(dataForSeo.keywordIdeas).toHaveBeenCalledWith(
    expect.objectContaining({ keywords: ['dog food'] }),
  );
});

it('skips keywordIdeas when no seeds are produced', async () => {
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([]),
    rankedKeywords: vi.fn().mockResolvedValue([]),
    keywordIdeas: vi.fn(),
  } as unknown as DataForSeoClient;
  const llm = {
    complete: vi.fn().mockResolvedValue({
      text: '{"seeds":[]}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  } as unknown as LlmClient;

  await gatherCandidates(
    { websiteUrl: 'https://acme.io', competitors: [], presets, clients: { dataForSeo, llm } },
    config,
  );
  expect(dataForSeo.keywordIdeas).not.toHaveBeenCalled();
});
