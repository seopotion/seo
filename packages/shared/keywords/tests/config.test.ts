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

  it('caller overrides win and merge deeply', () => {
    const c = resolveConfig(presets, { serpTopN: 5, weights: { volume: 0.9 } as never });
    expect(c.serpTopN).toBe(5);
    expect(c.weights.volume).toBe(0.9);
    expect(c.weights.relevance).toBe(DEFAULT_CONFIG.weights.relevance);
  });
});
