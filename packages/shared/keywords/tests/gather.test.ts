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
    keywordSuggestions: vi.fn().mockResolvedValue([metric('suggested kw')]),
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
    'keyword_suggestions',
    'keywords_for_site',
    'ranked_keywords',
  ]);
  expect(out.find((c) => c.source === 'ranked_keywords')!.source_context).toBe('comp.com');
  // keyword_suggestions takes ONE seed per call, so gather fans out per seed and
  // tags each candidate with the seed that produced it.
  expect(dataForSeo.keywordSuggestions).toHaveBeenCalledWith(
    expect.objectContaining({ keyword: 'dog food' }),
  );
  expect(out.find((c) => c.source === 'keyword_suggestions')!.source_context).toBe('dog food');
});

it('pushes the volume filter and ordering down to every gather endpoint', async () => {
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([]),
    rankedKeywords: vi.fn().mockResolvedValue([]),
    keywordSuggestions: vi.fn().mockResolvedValue([]),
  } as unknown as DataForSeoClient;
  const llm = {
    complete: vi.fn().mockResolvedValue({
      text: '{"seeds":["dog food"]}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  } as unknown as LlmClient;

  await gatherCandidates(
    {
      websiteUrl: 'https://acme.io',
      competitors: ['comp.com'],
      presets,
      clients: { dataForSeo, llm },
    },
    { ...config, minSearchVolume: 25 },
  );

  const labs = {
    filters: [['keyword_info.search_volume', '>=', 25]],
    orderBy: ['keyword_info.search_volume,desc'],
  };
  // keywords_for_site keeps the endpoint's own relevance order — volume order
  // makes its head generic noise (#211).
  expect(dataForSeo.keywordsForSite).toHaveBeenCalledWith(
    expect.objectContaining({
      filters: labs.filters,
      orderBy: ['relevance,desc'],
      limit: config.endpointLimits.keywordsForSite,
    }),
  );
  expect(dataForSeo.keywordSuggestions).toHaveBeenCalledWith(
    expect.objectContaining({ ...labs, limit: config.endpointLimits.keywordSuggestions }),
  );
  // ranked_keywords nests the same metrics under `keyword_data`.
  expect(dataForSeo.rankedKeywords).toHaveBeenCalledWith(
    expect.objectContaining({
      filters: [['keyword_data.keyword_info.search_volume', '>=', 25]],
      orderBy: ['keyword_data.keyword_info.search_volume,desc'],
      limit: config.endpointLimits.rankedKeywords,
    }),
  );
});

it('caps how many seeds fan out to keyword_suggestions', async () => {
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([]),
    rankedKeywords: vi.fn().mockResolvedValue([]),
    keywordSuggestions: vi.fn().mockResolvedValue([]),
  } as unknown as DataForSeoClient;
  const seeds = Array.from({ length: 30 }, (_, i) => `seed ${i}`);
  const llm = {
    complete: vi.fn().mockResolvedValue({
      text: JSON.stringify({ seeds }),
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  } as unknown as LlmClient;

  await gatherCandidates(
    { websiteUrl: 'https://acme.io', competitors: [], presets, clients: { dataForSeo, llm } },
    config,
  );

  expect((dataForSeo.keywordSuggestions as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(15);
});

it('feeds competitor wins into the seed prompt, highest volume first', async () => {
  const win = (keyword: string, volume: number | null): KeywordMetric => ({
    ...metric(keyword),
    search_volume: volume,
  });
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([]),
    rankedKeywords: vi
      .fn()
      .mockResolvedValue([
        win('low volume kw', 10),
        win('top volume kw', 900),
        win('no volume kw', null),
      ]),
    keywordSuggestions: vi.fn().mockResolvedValue([]),
  } as unknown as DataForSeoClient;
  const llm = {
    complete: vi.fn().mockResolvedValue({
      text: '{"seeds":["dog food"]}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  } as unknown as LlmClient;

  await gatherCandidates(
    {
      websiteUrl: 'https://acme.io',
      competitors: ['comp.com'],
      presets,
      clients: { dataForSeo, llm },
    },
    config,
  );

  const seedCall = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  const user = seedCall.messages.find((m: { role: string }) => m.role === 'user');
  const topIdx = user.content.indexOf('top volume kw');
  const lowIdx = user.content.indexOf('low volume kw');
  expect(topIdx).toBeGreaterThan(-1);
  expect(lowIdx).toBeGreaterThan(topIdx);
});

it('caps competitor wins passed to the seed prompt', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({
    ...metric(`competitor kw ${i}`),
    search_volume: 1000 - i,
  }));
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([]),
    rankedKeywords: vi.fn().mockResolvedValue(many),
    keywordSuggestions: vi.fn().mockResolvedValue([]),
  } as unknown as DataForSeoClient;
  const llm = {
    complete: vi.fn().mockResolvedValue({
      text: '{"seeds":[]}',
      model: 'm',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    }),
  } as unknown as LlmClient;

  await gatherCandidates(
    {
      websiteUrl: 'https://acme.io',
      competitors: ['comp.com'],
      presets,
      clients: { dataForSeo, llm },
    },
    config,
  );

  const seedCall = (llm.complete as ReturnType<typeof vi.fn>).mock.calls[0]![0];
  const user = seedCall.messages.find((m: { role: string }) => m.role === 'user');
  expect(user.content).toContain('competitor kw 0');
  expect(user.content).not.toContain('competitor kw 35');
});

it('skips keywordSuggestions when no seeds are produced', async () => {
  const dataForSeo = {
    keywordsForSite: vi.fn().mockResolvedValue([]),
    rankedKeywords: vi.fn().mockResolvedValue([]),
    keywordSuggestions: vi.fn(),
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
  expect(dataForSeo.keywordSuggestions).not.toHaveBeenCalled();
});
