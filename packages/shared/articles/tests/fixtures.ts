import type { ArticleRun, ContentComplexity } from '@shared/schemas';
import { ArticleRunSchema } from '@shared/schemas';

// Copied from apps/worker/tests/generation.test.ts (that fixture disappears
// when apps/worker/src/generation.ts is deleted in Task 10).
export const presets = {
  business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
  audience: { target: ['makers'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: {
      article_style: 'x',
      internal_links_count: 0,
      table_of_contents: true,
      readability_grade_max: 8,
      content_complexity: 'general' as ContentComplexity,
      llm_instructions: '',
    },
    engagement: {
      image_direction: { medium: 'photograph', palette: '', notes: '' },
      include_cta: true,
      youtube_videos: true,
    },
    publishing: { auto_publish: false },
  },
};

export const org = {
  id: 'o1',
  plan: 'paid',
  website_url: 'https://x.com',
  presets,
};

export const keyword = {
  id: 'k1',
  org_id: 'o1',
  keyword: 'best widgets',
  status: 'scheduled' as const,
  scheduled_date: '2026-01-01',
  difficulty: 10,
  search_volume: 100,
  article_id: null,
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  created_at: new Date('2026-01-01'),
};

// Copied from packages/shared/generation/tests/generate.test.ts.
export const outlineJson = JSON.stringify({
  h1: 'Best Widgets For Makers',
  meta_title: 'Best Widgets For Makers 2026',
  meta_description: 'x'.repeat(140),
  slug: 'best-widgets',
  sections: [
    { heading: 'One', intent: 'i' },
    { heading: 'Two', intent: 'i' },
  ],
  cta: 'Compare the best Acme option for your needs.',
});

/** Builds a fully-parsed ArticleRun, using `presets`/`keyword` as the launch snapshot. */
export function makeRun(
  overrides: {
    working?: Record<string, unknown>;
    presets?: typeof presets;
    status?: ArticleRun['status'];
    stages?: ArticleRun['stages'];
  } = {},
): ArticleRun {
  return ArticleRunSchema.parse({
    id: 'run1',
    org_id: 'o1',
    keyword_id: 'k1',
    status: overrides.status ?? 'running',
    stages: overrides.stages ?? {},
    input: { website_url: 'https://x.com', presets: overrides.presets ?? presets, keyword },
    working: {
      link_candidates: [],
      outline: null,
      draft: null,
      humanize_attempts: [],
      content: null,
      readability_grade: null,
      article_id: null,
      ...overrides.working,
    },
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
  });
}
