import { describe, expect, it } from 'vitest';
import { STRATEGY_STAGES, StrategyRunSchema, WorkingCandidateSchema } from '../src/index';

const minimalCandidate = {
  keyword: 'ro membrane fouling',
  normalized: 'ro membrane fouling',
  source: 'keyword_suggestions',
};

function buildPresetsFixture() {
  return {
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
  };
}

describe('WorkingCandidateSchema', () => {
  it('fills defaults so a minimal candidate round-trips', () => {
    const c = WorkingCandidateSchema.parse(minimalCandidate);
    expect(c.status).toBe('candidate');
    expect(c.serp_validated).toBe(false);
    expect(c.relevance_score).toBeNull();
    expect(c.category_ids).toEqual([]);
    expect(c.serp_competitors).toBeNull();
  });
});

describe('StrategyRunSchema', () => {
  it('parses a fresh run and a stage-stamped run', () => {
    const base = {
      id: 'r1',
      org_id: 'o1',
      status: 'running',
      input: {
        website_url: 'https://x.com',
        presets: undefined as unknown, // replaced below with a real preset fixture
        existing_keywords: [],
      },
      created_at: new Date(),
      updated_at: new Date(),
    };
    const presets = buildPresetsFixture();
    const run = StrategyRunSchema.parse({ ...base, input: { ...base.input, presets } });
    expect(run.stages).toEqual({});
    expect(run.candidates).toEqual([]);

    const stamped = StrategyRunSchema.parse({
      ...base,
      input: { ...base.input, presets },
      stages: {
        gather: {
          status: 'completed',
          started_at: new Date(),
          finished_at: new Date(),
          stats: { gathered: 10 },
          error: null,
        },
      },
      candidates: [WorkingCandidateSchema.parse(minimalCandidate)],
    });
    expect(stamped.stages.gather?.status).toBe('completed');
    expect(STRATEGY_STAGES).toContain('persist_schedule');
  });
});
