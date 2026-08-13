import type { DataForSeoClient, LlmClient, SerpResult } from '@shared/providers';
import type { SetupPresets, WorkingCandidate } from '@shared/schemas';
import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from '../src/config';
import { PlanParseError } from '../src/plan-contract';
import {
  emptyWorkState,
  type StageContext,
  type StrategyWorkState,
  stageEnrich,
  stageGather,
  stagePlan,
  stageSerpFetch,
  stageTriage,
} from '../src/stages';

const presets: SetupPresets = {
  business: {
    name: 'Acme',
    language: 'English',
    country: 'United States',
    description: 'pet food',
  },
  audience: { target: ['dog owners'], competitors: [] },
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
};

const cand = (keyword: string, overrides: Partial<WorkingCandidate> = {}): WorkingCandidate => ({
  keyword,
  normalized: keyword,
  source: 'keywords_for_site',
  source_context: null,
  core_keyword: null,
  category_ids: [],
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  search_volume: 100,
  difficulty: 20,
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
  serp_validated: false,
  ...overrides,
});

const reply = (text: string) => ({
  text,
  model: 'm',
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
});

const serp = (domains: string[]): SerpResult[] =>
  domains.map((d, i) => ({ rank: i + 1, url: `https://${d}/p${i}`, domain: d, title: `t${i}` }));

const noopDataForSeo = {
  keywordsForSite: vi.fn(async () => []),
  rankedKeywords: vi.fn(async () => []),
  keywordSuggestions: vi.fn(async () => []),
  bulkKeywordDifficulty: vi.fn(async () => []),
  serpGoogleOrganic: vi.fn(async () => []),
} as unknown as DataForSeoClient;

const noopLlm: LlmClient = { complete: vi.fn(async () => reply('{}')) };

function makeCtx(overrides: Partial<StageContext> = {}): StageContext {
  return {
    orgId: 'org1',
    websiteUrl: 'https://acme.io',
    presets,
    competitors: [],
    existingKeywords: [],
    clients: { dataForSeo: noopDataForSeo, llm: noopLlm },
    config: resolveConfig(presets),
    ...overrides,
  };
}

function stateWith(candidates: WorkingCandidate[]): StrategyWorkState {
  return { ...emptyWorkState(), candidates };
}

describe('stageTriage', () => {
  // Moved from pipeline.test.ts's #211 regression (relevance coverage guard).
  it('throws the coverage-guard error when the relevance mock answers under minLlmCoverage', async () => {
    const llm: LlmClient = { complete: vi.fn(async () => reply('')) };
    const ctx = makeCtx({ clients: { dataForSeo: noopDataForSeo, llm } });
    const state = stateWith([cand('a'), cand('b')]);

    await expect(stageTriage(state, ctx)).rejects.toThrow(
      /relevance LLM answered only 0 of 2 keywords \(0%, minLlmCoverage 50%\)/,
    );
  });
});

describe('stageSerpFetch', () => {
  it('rejects an authority-dominated SERP with serp_authority and stamps serp_competitors on survivors with serp_validated false', async () => {
    const dataForSeo = {
      ...noopDataForSeo,
      serpGoogleOrganic: vi.fn(async ({ keyword }: { keyword: string }) =>
        keyword === 'authority kw'
          ? serp(['wikipedia.org', 'amazon.com', 'blog-a.com', 'blog-b.com'])
          : serp(['blog-c.com', 'blog-d.com', 'blog-e.com', 'blog-f.com']),
      ),
    } as unknown as DataForSeoClient;
    const ctx = makeCtx({ clients: { dataForSeo, llm: noopLlm } });
    const state = stateWith([cand('authority kw'), cand('clean kw')]);

    const out = await stageSerpFetch(state, ctx);

    const rejected = out.rejected.find((c) => c.keyword === 'authority kw');
    expect(rejected?.rejection_reason).toBe('serp_authority');

    const survivor = out.candidates.find((c) => c.keyword === 'clean kw');
    expect(survivor?.serp_validated).toBe(false);
    expect(survivor?.serp_competitors).toEqual([
      { rank: 1, url: 'https://blog-c.com/p0', domain: 'blog-c.com', title: 't0' },
      { rank: 2, url: 'https://blog-d.com/p1', domain: 'blog-d.com', title: 't1' },
      { rank: 3, url: 'https://blog-e.com/p2', domain: 'blog-e.com', title: 't2' },
      { rank: 4, url: 'https://blog-f.com/p3', domain: 'blog-f.com', title: 't3' },
    ]);
    expect(out.stats).toMatchObject({ serpFetched: 2, authorityRejected: 1 });
  });
});

describe('stagePlan', () => {
  const planCandidates = () => [cand('membrane fouling', { opportunity_score: 80 })];

  it('skips the LLM call and produces an empty plan coverage when candidates is empty', async () => {
    const ctx = makeCtx();
    const out = await stagePlan(emptyWorkState(), ctx);
    expect(ctx.clients.llm.complete).not.toHaveBeenCalled();
    expect(out.candidates).toEqual([]);
    expect(out.stats.plan).toMatchObject({
      finalists: 0,
      verdicts: 0,
      accepted: 0,
      targets: 0,
      clusters: 0,
      repairRetried: false,
    });
  });

  it('happy path: accepted candidates carry topic fields and serp_validated true', async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () =>
        reply(
          JSON.stringify({
            verdicts: [
              { index: 0, intent_ok: true, locality_ok: true, article_type: 'how_to_guide' },
            ],
            targets: [
              {
                cluster: 'Fouling',
                member_indices: [0],
                content_focus: 'What fouling is',
                is_pillar: true,
              },
            ],
          }),
        ),
      ),
    };
    const ctx = makeCtx({ clients: { dataForSeo: noopDataForSeo, llm } });
    const state = stateWith(planCandidates());

    const out = await stagePlan(state, ctx);

    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]).toMatchObject({
      keyword: 'membrane fouling',
      topic_cluster_label: 'Fouling',
      topic_role: 'pillar',
      article_type: 'how_to_guide',
      serp_validated: true,
    });
    expect(out.stats.plan).toMatchObject({ accepted: 1, repairRetried: false });
  });

  it('repair ladder: garbage then valid JSON succeeds, marks repairRetried, and the retry carries the error text', async () => {
    const validText = JSON.stringify({
      verdicts: [{ index: 0, intent_ok: true, locality_ok: true, article_type: 'other' }],
      targets: [],
    });
    const complete = vi
      .fn()
      .mockResolvedValueOnce(reply('garbage'))
      .mockResolvedValueOnce(reply(validText));
    const llm: LlmClient = { complete };
    const ctx = makeCtx({ clients: { dataForSeo: noopDataForSeo, llm } });
    const state = stateWith(planCandidates());

    const out = await stagePlan(state, ctx);

    expect(out.stats.plan).toMatchObject({ repairRetried: true, accepted: 1 });
    expect(complete).toHaveBeenCalledTimes(2);
    const secondCallMessages = complete.mock.calls[1]![0].messages as {
      role: string;
      content: string;
    }[];
    expect(secondCallMessages.some((m) => m.role === 'assistant' && m.content === 'garbage')).toBe(
      true,
    );
    expect(secondCallMessages.at(-1)!.content).toContain('plan response is not valid JSON');
  });

  it('double failure: both calls garbage throws PlanParseError', async () => {
    const complete = vi.fn().mockResolvedValue(reply('garbage'));
    const llm: LlmClient = { complete };
    const ctx = makeCtx({ clients: { dataForSeo: noopDataForSeo, llm } });
    const state = stateWith(planCandidates());

    await expect(stagePlan(state, ctx)).rejects.toThrow(PlanParseError);
    expect(complete).toHaveBeenCalledTimes(2);
  });
});

describe('state immutability', () => {
  it('does not mutate the input state object across any stage', async () => {
    const ctx = makeCtx({
      clients: {
        dataForSeo: noopDataForSeo,
        llm: { complete: vi.fn(async () => reply('{}')) },
      },
    });

    let state: StrategyWorkState = Object.freeze({
      ...emptyWorkState(),
      candidates: Object.freeze([cand('a')]) as unknown as WorkingCandidate[],
    });
    const snapshot = { ...state, candidates: [...state.candidates] };

    const afterGather = await stageGather(state, ctx);
    expect(state).toEqual(snapshot);
    expect(afterGather).not.toBe(state);

    state = Object.freeze({
      ...afterGather,
      candidates: Object.freeze([cand('b')]) as unknown as WorkingCandidate[],
    });
    const snapshot2 = { ...state, candidates: [...state.candidates] };
    const afterEnrich = await stageEnrich(state, ctx);
    expect(state).toEqual(snapshot2);
    expect(afterEnrich).not.toBe(state);
  });
});
