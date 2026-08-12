import type { PipelineInput } from '@shared/keywords';
import { runKeywordPipeline } from '@shared/keywords';
import type {
  DataForSeoClient,
  KeywordMetric,
  LlmClient,
  SerpParams,
  SerpResult,
} from '@shared/providers';
import { describe, expect, it, vi } from 'vitest';

const metric = (keyword: string, over: Partial<KeywordMetric> = {}): KeywordMetric => ({
  keyword,
  core_keyword: null,
  category_ids: [],
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

/** One suitable verdict per `Keyword <i>:` block the judge prompt carries. */
function judgeAll(userContent: string): string {
  const count = (userContent.match(/^Keyword \d+:/gm) ?? []).length;
  return JSON.stringify({
    judgments: Array.from({ length: count }, (_, index) => ({
      index,
      intentSuitable: true,
      localitySuitable: true,
      reason: null,
    })),
  });
}

const numberedKeywords = (userContent: string): string[] =>
  [...userContent.matchAll(/^\d+\. (.+)$/gm)].map((match) => match[1] as string);

function topicResponse(userContent: string): string {
  const indices = userContent
    .split('\n')
    .filter((line) => line.startsWith('{"index":'))
    .map((line) => (JSON.parse(line) as { index: number }).index);
  return JSON.stringify({
    clusters:
      indices.length === 0
        ? []
        : [
            {
              label: 'Dog food',
              pillar_index: indices[0],
              targets: indices.map((index) => ({
                primary_index: index,
                member_indices: [index],
                content_focus: `Article target ${index}`,
              })),
            },
          ],
  });
}

// Deterministic fake LLM: routes by the system prompt's leading instruction.
function fakeLlm(): LlmClient {
  return {
    complete: async ({ messages }) => {
      const sys = messages[0]!.content;
      let text = '{}';
      if (sys.includes('seed keywords')) text = '{"seeds":["dog food"]}';
      else if (sys.includes('Score each keyword')) {
        text = JSON.stringify({
          scores: numberedKeywords(messages[1]!.content).map((_keyword, index) => ({
            index,
            relevance: Math.max(0.1, 0.9 - index * 0.1),
          })),
        });
      } else if (sys.includes('could rank')) text = judgeAll(messages[1]!.content);
      else if (sys.includes('Classify each keyword')) {
        text = JSON.stringify({
          types: numberedKeywords(messages[1]!.content).map((_keyword, index) => ({
            index,
            article_type: index === 0 ? 'listicle' : 'product_guide',
          })),
        });
      } else if (sys.includes('Assign the candidates to broad topic clusters'))
        text = topicResponse(messages[1]!.content);
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
    keywordSuggestions: async () => [
      metric('acme login', { difficulty: 5 }),
      metric('premium dog food', { difficulty: 90 }),
    ],
    bulkKeywordDifficulty: async () => [],
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

  it('produces SERP-validated site and suggestion candidates without competitors', async () => {
    const keywordsForSite = vi.fn(async () => [
      metric('cheap dog food', { core_keyword: 'dog food', category_ids: [10] }),
    ]);
    const rankedKeywords = vi.fn(async () => [metric('competitor-only keyword')]);
    const keywordSuggestions = vi.fn(async () => [
      metric('dog food delivery', { core_keyword: 'dog food', category_ids: [10, 20] }),
    ]);
    const serpGoogleOrganic = vi.fn(async ({ keyword }: SerpParams) => {
      const slug = keyword.replace(/\s/g, '');
      return serp([`${slug}-a.com`, `${slug}-b.com`, `${slug}-c.com`, `${slug}-d.com`]);
    });
    const dataForSeo = {
      ...fakeDataForSeo(),
      keywordsForSite,
      rankedKeywords,
      keywordSuggestions,
      serpGoogleOrganic,
    };
    const llm = fakeLlm();
    const complete = vi.fn(llm.complete);
    const base = input();

    const { candidates, stats } = await runKeywordPipeline({
      ...base,
      competitors: [],
      presets: {
        ...base.presets,
        audience: { ...base.presets.audience, competitors: [] },
      },
      clients: { dataForSeo, llm: { complete } },
    });

    expect(rankedKeywords).not.toHaveBeenCalled();
    expect(keywordsForSite).toHaveBeenCalledOnce();
    expect(
      complete.mock.calls.some(([params]) => params.messages[0]!.content.includes('seed keywords')),
    ).toBe(true);
    expect(keywordSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'dog food' }),
    );
    expect(serpGoogleOrganic).toHaveBeenCalledTimes(2);
    const topicCalls = complete.mock.calls.filter(([params]) =>
      params.messages[0]!.content.includes('Assign the candidates to broad topic clusters'),
    );
    expect(topicCalls).toHaveLength(1);
    expect(topicCalls[0]![0].messages.map((message) => message.content).join('\n')).not.toMatch(
      /comp\.com|competitor/i,
    );
    expect(stats.accepted).toBe(2);
    expect(candidates.filter((candidate) => candidate.serp_validated)).toEqual([
      expect.objectContaining({
        keyword: 'cheap dog food',
        source: 'keywords_for_site',
        core_keyword: 'dog food',
        category_ids: [10],
      }),
      expect.objectContaining({
        keyword: 'dog food delivery',
        source: 'keyword_suggestions',
        core_keyword: 'dog food',
        category_ids: [10, 20],
      }),
    ]);
  });

  it('replaces lexical and SERP duplicate gates with one post-classification topic assignment', async () => {
    const lexicalVariants = [
      metric('guide to membrane fouling', {
        difficulty: null,
        core_keyword: 'membrane fouling guide',
        category_ids: [10],
      }),
      metric('membrane fouling guide', {
        difficulty: null,
        core_keyword: 'membrane fouling guide',
        category_ids: [10, 20],
      }),
      metric('prevent membrane fouling', {
        difficulty: null,
        core_keyword: 'prevent membrane fouling',
        category_ids: [20],
      }),
    ];
    const keywordsForSite = vi.fn(async () => lexicalVariants);
    const rankedKeywords = vi.fn(async () => []);
    const keywordSuggestions = vi.fn(async () => []);
    const bulkKeywordDifficulty = vi.fn(async ({ keywords }: { keywords: string[] }) =>
      keywords.map((keyword) => metric(keyword, { difficulty: 20 })),
    );
    const sharedSerp = serp(['shared-a.com', 'shared-b.com', 'shared-c.com', 'shared-d.com']);
    const serpGoogleOrganic = vi.fn(async ({ keyword }: SerpParams) =>
      keyword === 'prevent membrane fouling'
        ? serp(['prevent-a.com', 'prevent-b.com', 'prevent-c.com', 'prevent-d.com'])
        : sharedSerp,
    );
    const dataForSeo = {
      ...fakeDataForSeo(),
      keywordsForSite,
      rankedKeywords,
      keywordSuggestions,
      bulkKeywordDifficulty,
      serpGoogleOrganic,
    };
    const baseLlm = fakeLlm();
    const stageOrder: string[] = [];
    const complete = vi.fn(async (params: Parameters<LlmClient['complete']>[0]) => {
      const system = params.messages[0]!.content;
      stageOrder.push(system);
      if (!system.includes('Assign the candidates to broad topic clusters')) {
        return baseLlm.complete(params);
      }
      return {
        text: JSON.stringify({
          clusters: [
            {
              label: 'Membrane fouling',
              pillar_index: 0,
              targets: [
                {
                  primary_index: 0,
                  member_indices: [0, 1],
                  content_focus: 'What membrane fouling is and why it occurs',
                },
                {
                  primary_index: 2,
                  member_indices: [2],
                  content_focus: 'How operators can prevent membrane fouling',
                },
              ],
            },
          ],
        }),
        model: 'topic-model',
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
      };
    });
    const base = input();

    const { candidates, stats } = await runKeywordPipeline({
      ...base,
      competitors: [],
      presets: {
        ...base.presets,
        audience: { ...base.presets.audience, competitors: [] },
      },
      clients: { dataForSeo, llm: { complete } },
      config: { models: { topicClusters: 'custom-topic-model' } },
    });

    expect(rankedKeywords).not.toHaveBeenCalled();
    expect(bulkKeywordDifficulty).toHaveBeenCalledWith(
      expect.objectContaining({
        keywords: [
          'guide to membrane fouling',
          'membrane fouling guide',
          'prevent membrane fouling',
        ],
      }),
    );
    expect(serpGoogleOrganic).toHaveBeenCalledTimes(3);
    const relevanceCall = complete.mock.calls.find(([params]) =>
      params.messages[0]!.content.includes('Score each keyword'),
    );
    const relevancePrompt = relevanceCall?.[0].messages[1]?.content ?? '';
    expect(relevancePrompt).toContain('guide to membrane fouling');
    expect(relevancePrompt).toContain('membrane fouling guide');

    const topicCalls = complete.mock.calls.filter(([params]) =>
      params.messages[0]!.content.includes('Assign the candidates to broad topic clusters'),
    );
    expect(topicCalls).toHaveLength(1);
    expect(topicCalls[0]![0]).toMatchObject({
      model: 'custom-topic-model',
      temperature: 0,
      responseFormat: 'json',
    });
    const topicPrompt = topicCalls[0]![0].messages.map((message) => message.content).join('\n');
    expect(topicPrompt).toContain('guide to membrane fouling');
    expect(topicPrompt).toContain('membrane fouling guide');
    expect(topicPrompt).toContain('"serp_url_overlap":1');
    expect(topicPrompt).not.toMatch(/shared-a\.com|competitor/i);
    expect(stageOrder.findIndex((stage) => stage.includes('Classify each keyword'))).toBeLessThan(
      stageOrder.findIndex((stage) =>
        stage.includes('Assign the candidates to broad topic clusters'),
      ),
    );

    expect(candidates.map((candidate) => candidate.keyword)).toEqual([
      'guide to membrane fouling',
      'prevent membrane fouling',
      'membrane fouling guide',
    ]);
    const primary = candidates[0]!;
    expect(primary).toMatchObject({
      status: 'candidate',
      rejection_reason: null,
      serp_validated: true,
      topic_cluster_id: 'topic:guide to membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: 'pillar',
      topic_content_focus: 'What membrane fouling is and why it occurs',
      topic_primary_keyword: 'guide to membrane fouling',
    });
    expect(candidates[1]).toMatchObject({
      keyword: 'prevent membrane fouling',
      status: 'candidate',
      rejection_reason: null,
      topic_role: 'support',
      topic_primary_keyword: 'prevent membrane fouling',
    });
    expect(candidates[2]).toMatchObject({
      keyword: 'membrane fouling guide',
      status: 'rejected',
      rejection_reason: 'topic_duplicate',
      serp_validated: true,
      topic_cluster_id: primary.topic_cluster_id,
      topic_cluster_label: primary.topic_cluster_label,
      topic_role: 'pillar',
      topic_content_focus: primary.topic_content_focus,
      topic_primary_keyword: 'guide to membrane fouling',
    });
    expect(stats).toMatchObject({
      serpChecked: 3,
      serpValidated: 3,
      accepted: 2,
      topicClustering: {
        candidates: 3,
        clusters: 1,
        targets: 2,
        duplicates: 1,
        pillars: 1,
        supports: 1,
      },
    });
    expect(stats.rejectedByReason).toMatchObject({
      clustered_duplicate: 0,
      serp_duplicate: 0,
      topic_duplicate: 1,
    });
    expect(
      candidates.some((candidate) => candidate.rejection_reason === 'clustered_duplicate'),
    ).toBe(false);
    expect(candidates.some((candidate) => candidate.rejection_reason === 'serp_duplicate')).toBe(
      false,
    );
  });

  it('reports the seeds it fanned out over, so a run documents its own input', async () => {
    const { stats } = await runKeywordPipeline(input());
    expect(stats.seeds).toEqual(['dog food']);

    const pinned = await runKeywordPipeline({ ...input(), config: { seeds: ['pinned seed'] } });
    expect(pinned.stats.seeds).toEqual(['pinned seed']);
  });

  it('uses Haiku by default for classification and topic clustering', async () => {
    const base = fakeLlm();
    const complete = vi.fn(base.complete);

    await runKeywordPipeline({
      ...input(),
      clients: { dataForSeo: fakeDataForSeo(), llm: { complete } },
    });

    const modelFor = (marker: string) =>
      complete.mock.calls.find(([params]) => params.messages[0]!.content.includes(marker))?.[0]
        .model;

    expect(modelFor('seed keywords')).toBeUndefined();
    expect(modelFor('Score each keyword')).toBeUndefined();
    expect(modelFor('could rank')).toBeUndefined();
    expect(modelFor('Classify each keyword')).toBe('anthropic/claude-haiku-4.5');
    expect(modelFor('Assign the candidates to broad topic clusters')).toBe(
      'anthropic/claude-haiku-4.5',
    );
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

  it('rejects serpTopN above 150 before any provider or LLM method is called', async () => {
    const dataForSeo = {
      keywordsForSite: vi.fn(),
      rankedKeywords: vi.fn(),
      keywordSuggestions: vi.fn(),
      bulkKeywordDifficulty: vi.fn(),
      serpGoogleOrganic: vi.fn(),
    } as unknown as DataForSeoClient;
    const complete = vi.fn();

    await expect(
      runKeywordPipeline({
        ...input(),
        clients: { dataForSeo, llm: { complete } },
        config: { serpTopN: 151 },
      }),
    ).rejects.toThrow(/serpTopN 151 exceeds the topic-clustering maximum of 150/);

    expect(complete).not.toHaveBeenCalled();
    expect(dataForSeo.keywordsForSite).not.toHaveBeenCalled();
    expect(dataForSeo.rankedKeywords).not.toHaveBeenCalled();
    expect(dataForSeo.keywordSuggestions).not.toHaveBeenCalled();
    expect(dataForSeo.bulkKeywordDifficulty).not.toHaveBeenCalled();
    expect(dataForSeo.serpGoogleOrganic).not.toHaveBeenCalled();
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
  ])('rejects invalid serpTopN %s before provider work', async (serpTopN) => {
    const keywordsForSite = vi.fn();
    const complete = vi.fn();
    await expect(
      runKeywordPipeline({
        ...input(),
        clients: {
          dataForSeo: { ...fakeDataForSeo(), keywordsForSite },
          llm: { complete },
        },
        config: { serpTopN },
      }),
    ).rejects.toThrow(/serpTopN must be a non-negative integer/);
    expect(keywordsForSite).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it('accepts the configured 150-candidate semantic bound', async () => {
    const { stats } = await runKeywordPipeline({ ...input(), config: { serpTopN: 150 } });
    expect(stats.serpChecked).toBe(2);
    expect(stats.topicClustering.candidates).toBe(2);
  });

  it('distinguishes SERP checked from validated before topic-clustering counts', async () => {
    const base = input();
    const dataForSeo = {
      ...fakeDataForSeo(),
      keywordsForSite: async () => [metric('authority research'), metric('clean research')],
      rankedKeywords: vi.fn(async () => []),
      keywordSuggestions: async () => [],
      serpGoogleOrganic: async ({ keyword }: SerpParams) =>
        keyword === 'authority research'
          ? serp(['wikipedia.org', 'amazon.com', 'blog-a.com', 'blog-b.com'])
          : serp(['clean-a.com', 'clean-b.com', 'clean-c.com', 'clean-d.com']),
    };

    const { candidates, stats } = await runKeywordPipeline({
      ...base,
      competitors: [],
      presets: {
        ...base.presets,
        audience: { ...base.presets.audience, competitors: [] },
      },
      clients: { dataForSeo, llm: fakeLlm() },
    });

    expect(stats).toMatchObject({
      serpChecked: 2,
      serpValidated: 1,
      accepted: 1,
      topicClustering: {
        candidates: 1,
        clusters: 1,
        targets: 1,
        duplicates: 0,
        pillars: 1,
        supports: 0,
      },
    });
    expect(
      candidates.find((candidate) => candidate.keyword === 'authority research'),
    ).toMatchObject({
      rejection_reason: 'serp_authority',
      topic_cluster_id: null,
      topic_role: null,
    });
  });

  it('stamps serp_validated only on candidates that passed SERP validation', async () => {
    const { candidates } = await runKeywordPipeline({ ...input(), config: { serpTopN: 1 } });
    const validated = candidates.filter((c) => c.serp_validated);
    expect(validated.map((c) => c.keyword)).toEqual(['cheap dog food']);
    // The below-N survivor is unrejected but unvalidated — the tier that used to
    // backfill the plan (#211).
    const belowN = candidates.find((c) => c.keyword === 'dog food delivery');
    expect(belowN).toMatchObject({
      rejection_reason: null,
      serp_validated: false,
      topic_cluster_id: null,
      topic_cluster_label: null,
      topic_role: null,
      topic_content_focus: null,
      topic_primary_keyword: null,
    });
    for (const keyword of ['acme login', 'premium dog food']) {
      expect(candidates.find((candidate) => candidate.keyword === keyword)).toMatchObject({
        topic_cluster_id: null,
        topic_cluster_label: null,
        topic_role: null,
        topic_content_focus: null,
        topic_primary_keyword: null,
      });
    }
  });

  describe('relevance floor', () => {
    // The fake LLM scores only the keywords named here; anything else stays null.
    const scoring = (scores: Record<string, number>): LlmClient => {
      const base = fakeLlm();
      return {
        complete: async (params) => {
          if (!params.messages[0]!.content.includes('Score each keyword')) {
            return base.complete(params);
          }
          const list = Object.entries(scores).map(([keyword, relevance]) => ({
            keyword,
            relevance,
          }));
          return {
            text: JSON.stringify({ scores: list }),
            model: 'm',
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
          };
        },
      };
    };

    const run = async (scores: Record<string, number>, relevanceFloor?: number) =>
      runKeywordPipeline({
        ...input(),
        clients: { dataForSeo: fakeDataForSeo(), llm: scoring(scores) },
        config: relevanceFloor === undefined ? {} : { relevanceFloor },
      });

    it('rejects exactly 0 and keeps 0.01 at the default floor', async () => {
      const { candidates, stats } = await run({
        'cheap dog food': 0.01,
        'dog food delivery': 0,
      });
      const byKeyword = new Map(candidates.map((c) => [c.keyword, c]));
      expect(byKeyword.get('dog food delivery')!.rejection_reason).toBe('relevance_floor');
      expect(byKeyword.get('cheap dog food')!.rejection_reason).toBeNull();
      expect(stats.rejectedByReason.relevance_floor).toBe(1);
      expect(stats.afterRelevanceFloor).toBe(1);
    });

    it('honors a configured threshold, rejecting everything at or below it', async () => {
      const { candidates, stats } = await run(
        { 'cheap dog food': 0.5, 'dog food delivery': 0.4 },
        0.4,
      );
      const byKeyword = new Map(candidates.map((c) => [c.keyword, c]));
      expect(byKeyword.get('dog food delivery')!.rejection_reason).toBe('relevance_floor');
      expect(byKeyword.get('cheap dog food')!.rejection_reason).toBeNull();
      expect(stats.afterRelevanceFloor).toBe(1);
    });

    it('rejects before the top-N split, so a zero never spends a SERP slot', async () => {
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
        clients: {
          dataForSeo: wrapped,
          llm: scoring({ 'cheap dog food': 0.9, 'dog food delivery': 0 }),
        },
      });
      expect(serpCalls).toBe(1); // not 2 — the zero was dropped first
    });
  });

  /**
   * The failure this whole guard exists for: the relevance call comes back empty
   * — the exact 200-OK-with-no-content a reasoning model produces — and the run
   * must ABORT. Before the guard, parseRelevance seeded every keyword to 0, the
   * floor rejected all of them, and the worker marked the org `completed` with a
   * 30-day plan holding nothing (#211).
   */
  describe('failure guards', () => {
    /** fakeLlm with one stage's body replaced, routed by its system prompt. */
    const llmWith = (marker: string, text: string): LlmClient => {
      const base = fakeLlm();
      return {
        complete: async (params) =>
          params.messages[0]!.content.includes(marker)
            ? {
                text,
                model: 'm',
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
              }
            : base.complete(params),
      };
    };

    const runWith = (llm: LlmClient, config: PipelineInput['config'] = {}) =>
      runKeywordPipeline({
        ...input(),
        clients: { dataForSeo: fakeDataForSeo(), llm },
        config,
      });

    it('FAILS the run when the relevance body is empty, instead of shipping an empty plan', async () => {
      await expect(runWith(llmWith('Score each keyword', ''))).rejects.toThrow(
        /relevance LLM answered only 0 of 2 keywords \(0%, minLlmCoverage 50%\)/,
      );
    });

    it('fails the same way on an unparseable relevance body', async () => {
      await expect(
        runWith(llmWith('Score each keyword', 'I cannot help with that')),
      ).rejects.toThrow(/strategy aborted/);
    });

    it('completes when coverage is exactly at the floor', async () => {
      const { stats } = await runWith(
        llmWith('Score each keyword', '{"scores":[{"keyword":"cheap dog food","relevance":0.9}]}'),
      );
      expect(stats.relevance).toMatchObject({ sent: 2, returned: 1 });
    });

    // A null score is "never judged". Rejecting it at the floor is what turned a
    // partial degradation into a total one.
    it('does not let the relevance floor reject a candidate the model never scored', async () => {
      const { candidates } = await runWith(
        llmWith('Score each keyword', '{"scores":[{"keyword":"cheap dog food","relevance":0.9}]}'),
      );
      const unscored = candidates.find((c) => c.keyword === 'dog food delivery');
      expect(unscored).toMatchObject({ relevance_score: null, rejection_reason: null });
    });

    it('FAILS the run when the SERP judge answers nothing, rather than accepting every keyword fail-open', async () => {
      await expect(runWith(llmWith('could rank', ''))).rejects.toThrow(
        /SERP judge LLM answered only 0 of 2 keywords/,
      );
    });

    // Coverage is fine, every stage answered — but nothing survived. A plan with
    // no entries is still a failed run, not a successful empty one.
    it('FAILS the run when every candidate is rejected and the plan would be empty', async () => {
      const rejectAll = llmWith(
        'could rank',
        JSON.stringify({
          judgments: [0, 1].map((index) => ({
            index,
            intentSuitable: false,
            localitySuitable: true,
            reason: 'product pages',
          })),
        }),
      );
      await expect(runWith(rejectAll)).rejects.toThrow(
        /gathered \d+ keywords but accepted 0, so the plan would be empty/,
      );
    });

    it('fails the pipeline on invalid or incomplete topic-cluster output', async () => {
      await expect(
        runWith(llmWith('Assign the candidates to broad topic clusters', '{"clusters":[]}')),
      ).rejects.toThrow(/no clusters; covered 0\/2 candidate indexes/i);

      await expect(
        runWith(
          llmWith(
            'Assign the candidates to broad topic clusters',
            JSON.stringify({
              clusters: [
                {
                  label: 'Dog food',
                  pillar_index: 0,
                  targets: [
                    {
                      primary_index: 0,
                      member_indices: [0],
                      content_focus: 'Dog food overview',
                    },
                  ],
                },
              ],
            }),
          ),
        ),
      ).rejects.toThrow(/Missing candidate indexes \[1\]; covered 1\/2/i);
    });

    it('does not fire the empty-plan guard when nothing was gathered at all', async () => {
      const empty = {
        keywordsForSite: async () => [],
        rankedKeywords: async () => [],
        keywordSuggestions: async () => [],
        bulkKeywordDifficulty: async () => [],
        serpGoogleOrganic: async () => [],
      } as unknown as DataForSeoClient;
      const llm = fakeLlm();
      const complete = vi.fn(llm.complete);
      const { stats } = await runKeywordPipeline({
        ...input(),
        clients: { dataForSeo: empty, llm: { complete } },
      });
      expect(stats).toMatchObject({ gathered: 0, accepted: 0 });
      expect(stats.topicClustering).toEqual({
        candidates: 0,
        clusters: 0,
        targets: 0,
        duplicates: 0,
        pillars: 0,
        supports: 0,
      });
      expect(
        complete.mock.calls.some(([params]) =>
          params.messages[0]!.content.includes('Assign the candidates to broad topic clusters'),
        ),
      ).toBe(false);
    });

    it('minLlmCoverage 0 disables the guard', async () => {
      const { stats } = await runWith(llmWith('Score each keyword', ''), { minLlmCoverage: 0 });
      expect(stats.relevance.returned).toBe(0);
    });
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
