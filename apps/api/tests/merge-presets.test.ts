import { describe, expect, test } from 'vitest';
import { mergePresets } from '../src/lib/merge-presets';

const base = {
  business: { name: 'Old Co', language: 'English', country: 'US', description: 'Old.' },
  audience: { target: ['Devs'], competitors: ['a.com', 'b.com'] },
  blog: {
    sitemap_url: 'https://x.com/sitemap.xml',
    main_blog_url: 'https://x.com/blog',
    best_articles: ['https://x.com/1'],
  },
  article_preferences: {
    content_seo: {
      article_style: 'Formal',
      internal_links_count: 0,
      table_of_contents: true,
      readability_grade_max: 8,
      llm_instructions: 'old',
    },
    engagement: { image_style: 'Minimal', include_cta: true, youtube_videos: true },
    publishing: { auto_publish: false },
  },
};

describe('mergePresets', () => {
  test('merges a nested object field while preserving siblings', () => {
    const result = mergePresets(base, { business: { name: 'New Co' } });
    expect(result.business.name).toBe('New Co');
    expect(result.business.language).toBe('English');
    expect(result.business.country).toBe('US');
  });

  test('leaves untouched categories unchanged', () => {
    const result = mergePresets(base, { business: { name: 'New Co' } });
    expect(result.audience).toEqual(base.audience);
    expect(result.blog).toEqual(base.blog);
  });

  test('replaces array fields wholesale rather than concatenating', () => {
    const result = mergePresets(base, { audience: { competitors: ['c.com'] } });
    expect(result.audience.competitors).toEqual(['c.com']);
    expect(result.audience.target).toEqual(['Devs']);
  });

  test('merges the two-level nest under article_preferences', () => {
    const result = mergePresets(base, {
      article_preferences: { content_seo: { internal_links_count: 3 } },
    });
    expect(result.article_preferences.content_seo.internal_links_count).toBe(3);
    expect(result.article_preferences.content_seo.article_style).toBe('Formal');
    expect(result.article_preferences.engagement.image_style).toBe('Minimal');
  });

  test('undefined partial returns existing unchanged', () => {
    expect(mergePresets(base, undefined)).toEqual(base);
  });

  test('does not mutate the existing object', () => {
    const snapshot = structuredClone(base);
    mergePresets(base, { business: { name: 'New Co' } });
    expect(base).toEqual(snapshot);
  });
});
