import { describe, expect, it } from 'vitest';
import { ArticleSchema } from '../src/article';
import { ARTICLE_STAGES, ArticleRunSchema } from '../src/article-run';

const presets = {
  business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
  audience: { target: ['makers'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: {
      article_style: 'x',
      internal_links_count: 0,
      table_of_contents: true,
      llm_instructions: '',
    },
    engagement: { image_style: '', include_cta: true, youtube_videos: true },
    publishing: { auto_publish: false },
  },
};
const keyword = {
  id: 'k1',
  org_id: 'o1',
  candidate_id: null,
  keyword: 'best socks',
  status: 'scheduled',
  scheduled_date: '2026-08-28',
  search_volume: 100,
  difficulty: 10,
  article_id: null,
  created_at: new Date(),
};

describe('ArticleRunSchema', () => {
  it('parses a fresh run with defaulted stages and working state', () => {
    const run = ArticleRunSchema.parse({
      id: 'r1',
      org_id: 'o1',
      keyword_id: 'k1',
      status: 'running',
      input: { website_url: 'https://x.test', presets, keyword },
      created_at: new Date(),
      updated_at: new Date(),
    });
    expect(run.stages).toEqual({});
    expect(run.working).toEqual({
      link_candidates: [],
      outline: null,
      draft: null,
      humanize_attempts: [],
      content: null,
      readability_grade: null,
      article_id: null,
    });
  });

  it('orders stages prepare..handoff_publish', () => {
    expect(ARTICLE_STAGES).toEqual([
      'prepare',
      'outline',
      'draft',
      'humanize',
      'finalize',
      'images_plan',
      'images_render',
      'handoff_publish',
    ]);
  });
});

describe('ArticleSchema.readability', () => {
  const baseArticle = {
    id: 'a1',
    org_id: 'o1',
    keyword_id: 'k1',
    title: 'T',
    meta_title: 'mt',
    slug: 's',
    keyword: 'kw',
    meta_description: 'md',
    featured_image_url: '',
    content: '# T\n\nintro',
    difficulty: 1,
    search_volume: 2,
    status: 'generated',
    created_at: new Date(),
    published_at: null,
    images: [],
    images_status: 'pending',
  };

  it('defaults to null', () => {
    const article = ArticleSchema.parse(baseArticle);
    expect(article.readability).toBeNull();
  });

  it('accepts a stamped object', () => {
    const article = ArticleSchema.parse({
      ...baseArticle,
      readability: {
        metric: 'flesch_kincaid_grade',
        grade: 7.2,
        target: 8,
        target_met: true,
        attempts: 2,
      },
    });
    expect(article.readability).toEqual({
      metric: 'flesch_kincaid_grade',
      grade: 7.2,
      target: 8,
      target_met: true,
      attempts: 2,
    });
  });
});
