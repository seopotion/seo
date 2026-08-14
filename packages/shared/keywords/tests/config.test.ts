import { DEFAULT_CONFIG, resolveConfig } from '@shared/keywords';
import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it } from 'vitest';

const presets = {
  business: { name: 'Acme', language: 'English', country: 'United States', description: 'x' },
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

describe('resolveConfig', () => {
  it('derives location/language from presets by default', () => {
    const c = resolveConfig(presets);
    expect(c.locationName).toBe('United States');
    expect(c.languageName).toBe('English');
    expect(c.difficultyCeiling).toBe(45);
  });

  it('maps the "Global (English)" preset to the default DataForSEO location', () => {
    const global = {
      ...presets,
      business: { ...presets.business, country: 'Global (English)' },
    };
    const c = resolveConfig(global);
    expect(c.locationName).toBe('United States');
  });

  it('SERP-validates more than a full 30-day plan by default', () => {
    // The strategy worker schedules 30 entries (PLAN_DAYS); every one of them
    // should come from the SERP-validated top-N, with buffer for rejections.
    expect(DEFAULT_CONFIG.serpTopN).toBeGreaterThanOrEqual(40);
    expect(DEFAULT_CONFIG.serpTopN).toBe(150);
    expect(DEFAULT_CONFIG.models.plan).toBe('anthropic/claude-haiku-4.5');
    expect('clusterJaccard' in DEFAULT_CONFIG).toBe(false);
    expect('duplicateSerpOverlap' in DEFAULT_CONFIG).toBe(false);
  });

  it('caller overrides win and merge deeply', () => {
    const c = resolveConfig(presets, { serpTopN: 5, weights: { volume: 0.9 } as never });
    expect(c.serpTopN).toBe(5);
    expect(c.weights.volume).toBe(0.9);
    expect(c.weights.relevance).toBe(DEFAULT_CONFIG.weights.relevance);
  });
});
