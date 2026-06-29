import { describe, expect, test } from 'vitest';
import { mergePresets } from '../src/lib/merge-presets';

const base = {
  business: { name: 'Old Co', language: 'English', country: 'US', description: 'Old.' },
  audience: { target: 'Devs', competitors: ['a.com', 'b.com'] },
  blog: {
    sitemap_url: 'https://x.com/sitemap.xml',
    main_blog_url: 'https://x.com/blog',
    best_articles: ['https://x.com/1'],
  },
  article_preferences: {
    content_seo: { article_style: 'Formal', internal_links: false, llm_instructions: 'old' },
    engagement: { image_style: 'Minimal' },
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
    expect(result.audience.target).toBe('Devs');
  });

  test('merges the two-level nest under article_preferences', () => {
    const result = mergePresets(base, {
      article_preferences: { content_seo: { internal_links: true } },
    });
    expect(result.article_preferences.content_seo.internal_links).toBe(true);
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
