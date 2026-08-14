import type { SetupPresets, WorkingCandidate } from '@shared/schemas';
import { describe, expect, it } from 'vitest';
import { buildPlanPrompt, PlanParseError, parsePlanResponse } from '../src/plan-contract';

// Candidate + presets fixture builders, adapted from pipeline.test.ts's `input()`
// presets object and topic-clusters.test.ts's `candidate()` builder.
const candidateFixture = (overrides: Partial<WorkingCandidate> = {}): WorkingCandidate => ({
  keyword: 'ro membrane fouling',
  normalized: 'ro membrane fouling',
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
  intent: 'informational',
  relevance_score: null,
  opportunity_score: 50,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
  serp_competitors: null,
  serp_validated: false,
  ...overrides,
});

const presetsFixture = (): SetupPresets => ({
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
});

describe('parsePlanResponse', () => {
  it('parses a well-formed response', () => {
    const r = parsePlanResponse(
      JSON.stringify({
        verdicts: [{ index: 0, intent_ok: true, locality_ok: true, article_type: 'how_to_guide' }],
        targets: [
          { cluster: 'ro membranes', member_indices: [0], content_focus: 'x', is_pillar: true },
        ],
      }),
    );
    expect(r.verdicts).toHaveLength(1);
    expect(r.targets).toHaveLength(1);
    expect(r.droppedRows).toBe(0);
  });

  it('drops malformed rows instead of throwing', () => {
    const r = parsePlanResponse(
      JSON.stringify({
        verdicts: [
          { index: 0, intent_ok: true, locality_ok: true },
          { index: 'nope', intent_ok: true, locality_ok: true },
          { intent_ok: false },
          null,
        ],
        targets: [{ cluster: 5, member_indices: [0] }, null],
      }),
    );
    expect(r.verdicts).toHaveLength(1);
    expect(r.targets).toHaveLength(0);
    expect(r.droppedRows).toBe(5);
  });

  it('tolerates missing targets entirely (all-singleton plan)', () => {
    const r = parsePlanResponse(
      JSON.stringify({ verdicts: [{ index: 0, intent_ok: true, locality_ok: true }] }),
    );
    expect(r.targets).toEqual([]);
  });

  it('throws PlanParseError on non-JSON and on zero usable verdicts', () => {
    expect(() => parsePlanResponse('not json')).toThrow(PlanParseError);
    expect(() => parsePlanResponse('{"verdicts":[],"targets":[]}')).toThrow(PlanParseError);
  });
});

describe('buildPlanPrompt', () => {
  it('numbers candidates, includes SERP titles, states the omission rule', () => {
    const candidates = [
      candidateFixture({
        keyword: 'ro membrane fouling',
        serp_competitors: [
          { rank: 1, url: 'https://a.com/x', domain: 'a.com', title: 'Fouling guide' },
        ],
      }),
    ];
    const messages = buildPlanPrompt(candidates, presetsFixture());
    const system = messages[0]?.content ?? '';
    const user = messages[1]?.content ?? '';
    expect(system).toContain('standalone'); // omission = standalone article, not discard
    expect(system).toContain('intent_ok');
    expect(system).toContain('is_pillar');
    expect(user).toContain('0. ro membrane fouling');
    expect(user).toContain('Fouling guide');
  });

  it('caps at PLAN_MAX_CANDIDATES', () => {
    const many = Array.from({ length: 151 }, (_, i) => candidateFixture({ keyword: `k${i}` }));
    expect(() => buildPlanPrompt(many, presetsFixture())).toThrow(/150/);
  });
});
