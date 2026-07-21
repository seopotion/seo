import { describe, expect, test } from 'vitest';
import { SetupPresetsSchema } from '../src/presets';

const base = {
  business: { name: 'n', language: 'English', country: 'United States', description: 'd' },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: 's', internal_links_count: 1, llm_instructions: '' },
    engagement: { image_style: 'i' },
  },
};

describe('SetupPresetsSchema audience.target', () => {
  test('parses an array of strings', () => {
    const p = SetupPresetsSchema.parse({
      ...base,
      audience: { target: ['a', 'b'], competitors: [] },
    });
    expect(p.audience.target).toEqual(['a', 'b']);
  });

  test('coerces a legacy non-empty string to a single-element array (no comma split)', () => {
    const p = SetupPresetsSchema.parse({
      ...base,
      audience: { target: 'plant operators, and managers', competitors: [] },
    });
    expect(p.audience.target).toEqual(['plant operators, and managers']);
  });

  test('coerces a legacy empty string to an empty array', () => {
    const p = SetupPresetsSchema.parse({ ...base, audience: { target: '', competitors: [] } });
    expect(p.audience.target).toEqual([]);
  });

  test('rejects more than 7 entries', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `a${i}`);
    expect(() =>
      SetupPresetsSchema.parse({ ...base, audience: { target: eight, competitors: [] } }),
    ).toThrow();
  });
});

describe('SetupPresetsSchema article_preferences defaults + validation', () => {
  test('applies field defaults when omitted', () => {
    const p = SetupPresetsSchema.parse({
      ...base,
      audience: { target: [], competitors: [] },
    });
    expect(p.article_preferences.content_seo.internal_links_count).toBe(1);
    expect(p.article_preferences.content_seo.table_of_contents).toBe(true);
    expect(p.article_preferences.engagement.youtube_videos).toBe(true);
    expect(p.article_preferences.publishing.auto_publish).toBe(false);
  });

  test('rejects an out-of-range internal_links_count', () => {
    expect(() =>
      SetupPresetsSchema.parse({
        ...base,
        audience: { target: [], competitors: [] },
        article_preferences: {
          content_seo: { article_style: 's', internal_links_count: 4, llm_instructions: '' },
          engagement: { image_style: 'i' },
        },
      }),
    ).toThrow();
  });

  test('rejects a non-integer internal_links_count', () => {
    expect(() =>
      SetupPresetsSchema.parse({
        ...base,
        audience: { target: [], competitors: [] },
        article_preferences: {
          content_seo: { article_style: 's', internal_links_count: 1.5, llm_instructions: '' },
          engagement: { image_style: 'i' },
        },
      }),
    ).toThrow();
  });
});
