import type { PipelineInput } from '@shared/keywords';
import { runKeywordPipeline } from '@shared/keywords';
import type {
  DataForSeoClient,
  KeywordMetric,
  LlmClient,
  SerpParams,
  SerpResult,
} from '@shared/providers';
import { describe, expect, it } from 'vitest';

const metric = (keyword: string, over: Partial<KeywordMetric> = {}): KeywordMetric => ({
  keyword,
  search_volume: 100,
  difficulty: 20,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  ...over,
});

const serp = (domains: string[]): SerpResult[] =>
  domains.map((d, i) => ({ rank: i + 1, url: `https://${d}/p${i}`, domain: d, title: `t${i}` }));

// Deterministic fake LLM: routes by the system prompt's leading instruction.
function fakeLlm(): LlmClient {
  return {
    complete: async ({ messages }) => {
      const sys = messages[0]!.content;
      let text = '{}';
      if (sys.includes('seed keywords')) text = '{"seeds":["dog food"]}';
      else if (sys.includes('Score each keyword'))
        text =
          '{"scores":[{"keyword":"cheap dog food","relevance":0.9},{"keyword":"dog food delivery","relevance":0.8}]}';
      else if (sys.includes('could rank'))
        text = '{"intentSuitable":true,"localitySuitable":true,"reason":null}';
      else if (sys.includes('Classify each keyword'))
        text =
          '{"types":[{"keyword":"cheap dog food","article_type":"listicle"},{"keyword":"dog food delivery","article_type":"product_guide"}]}';
      return {
        text,
        model: 'm',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
      };
    },
  };
}

function fakeDataForSeo(): DataForSeoClient {
  return {
    keywordsForSite: async () => [metric('cheap dog food')],
    rankedKeywords: async () => [metric('dog food delivery')],
    keywordIdeas: async () => [
      metric('acme login', { difficulty: 5 }),
      metric('premium dog food', { difficulty: 90 }),
    ],
    bulkKeywordDifficulty: async () => [],
    // Distinct domains per keyword so SERPs never trip the duplicate-overlap check.
    serpGoogleOrganic: async ({ keyword }: SerpParams) => {
      const slug = keyword.replace(/\s/g, '');
      return serp([`${slug}-a.com`, `${slug}-b.com`, `${slug}-c.com`, `${slug}-d.com`]);
    },
  } as unknown as DataForSeoClient;
}

const input = (): PipelineInput => ({
  orgId: 'org1',
  websiteUrl: 'https://acme.io',
  presets: {
    business: {
      name: 'Acme',
      language: 'English',
      country: 'United States',
      description: 'pet food',
    },
    audience: { target: ['dog owners'], competitors: ['comp.com'] },
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
  },
  competitors: ['comp.com'],
  existingKeywords: [],
  existingArticleKeywords: [],
  clients: { dataForSeo: fakeDataForSeo(), llm: fakeLlm() },
});

describe('runKeywordPipeline', () => {
  it('produces accepted, classified candidates and records rejections with reasons', async () => {
    const { candidates, stats } = await runKeywordPipeline(input());

    const brand = candidates.find((c) => c.keyword === 'acme login');
    expect(brand!.status).toBe('rejected');
    expect(brand!.rejection_reason).toBe('brand_navigation');

    const overKd = candidates.find((c) => c.keyword === 'premium dog food');
    expect(overKd!.rejection_reason).toBe('difficulty_ceiling');

    const accepted = candidates.filter((c) => c.status === 'candidate' && c.article_type !== null);
    expect(accepted.map((c) => c.article_type).sort()).toEqual(['listicle', 'product_guide']);
    expect(accepted.every((c) => c.org_id === 'org1')).toBe(true);
    expect(stats.accepted).toBe(2);
  });

  it('is deterministic for fixed provider responses', async () => {
    const a = await runKeywordPipeline(input());
    const b = await runKeywordPipeline(input());
    expect(a).toEqual(b);
  });

  it('limits SERP validation to serpTopN', async () => {
    let serpCalls = 0;
    const dfs = fakeDataForSeo();
    const wrapped: DataForSeoClient = {
      ...dfs,
      serpGoogleOrganic: async (p) => {
        serpCalls++;
        return dfs.serpGoogleOrganic(p);
      },
    };
    await runKeywordPipeline({
      ...input(),
      clients: { dataForSeo: wrapped, llm: fakeLlm() },
      config: { serpTopN: 1 },
    });
    expect(serpCalls).toBe(1);
  });

  it('applies cannibalization penalty for a non-normalized existing keyword', async () => {
    const clean = await runKeywordPipeline(input());
    const penalized = await runKeywordPipeline({
      ...input(),
      existingKeywords: ['Cheap Dog Food'],
    });
    const scoreOf = (r: Awaited<ReturnType<typeof runKeywordPipeline>>) =>
      r.candidates.find((c) => c.keyword === 'cheap dog food')!.opportunity_score;
    expect(scoreOf(penalized)!).toBeLessThan(scoreOf(clean)!);
  });
});
