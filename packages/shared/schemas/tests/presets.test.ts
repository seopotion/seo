import { describe, expect, test } from 'vitest';
import {
  EngagementPrefsPatchSchema,
  IMAGE_MEDIA,
  ImageDirectionSchema,
  SetupPresetsSchema,
} from '../src/presets';

const direction = { medium: 'photograph', palette: '', notes: '' } as const;

const base = {
  business: { name: 'n', language: 'English', country: 'United States', description: 'd' },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: { article_style: 's', internal_links_count: 1, llm_instructions: '' },
    engagement: { image_direction: direction },
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
    expect(p.article_preferences.engagement.include_cta).toBe(true);
    expect(p.article_preferences.engagement.youtube_videos).toBe(true);
    expect(p.article_preferences.publishing.auto_publish).toBe(false);
  });

  test('preserves an explicitly disabled CTA preference', () => {
    const p = SetupPresetsSchema.parse({
      ...base,
      audience: { target: [], competitors: [] },
      article_preferences: {
        ...base.article_preferences,
        engagement: { image_direction: direction, include_cta: false },
      },
    });
    expect(p.article_preferences.engagement.include_cta).toBe(false);
  });

  test('engagement patches do not inject defaults for omitted fields', () => {
    expect(EngagementPrefsPatchSchema.parse({ image_direction: { medium: 'line_art' } })).toEqual({
      image_direction: { medium: 'line_art' },
    });
    expect(EngagementPrefsPatchSchema.parse({ youtube_videos: false })).toEqual({
      youtube_videos: false,
    });
  });

  test('rejects an out-of-range internal_links_count', () => {
    expect(() =>
      SetupPresetsSchema.parse({
        ...base,
        audience: { target: [], competitors: [] },
        article_preferences: {
          content_seo: { article_style: 's', internal_links_count: 4, llm_instructions: '' },
          engagement: { image_direction: direction },
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
          engagement: { image_direction: direction },
        },
      }),
    ).toThrow();
  });
});

describe('SetupPresetsSchema engagement.image_direction', () => {
  const withEngagement = (engagement: Record<string, unknown>) =>
    SetupPresetsSchema.parse({
      ...base,
      audience: { target: [], competitors: [] },
      article_preferences: { ...base.article_preferences, engagement },
    });

  test('passes a structured direction through', () => {
    const p = withEngagement({
      image_direction: { medium: 'flat_illustration', palette: 'teal and sand', notes: 'hardware' },
    });
    expect(p.article_preferences.engagement.image_direction).toEqual({
      medium: 'flat_illustration',
      palette: 'teal and sand',
      notes: 'hardware',
    });
  });

  // #312: pre-existing orgs stored a free-text image_style. It is moved into
  // notes on read, never dropped, and the medium starts as photograph.
  test('moves a legacy image_style into notes with a photograph medium', () => {
    const p = withEngagement({
      image_style: 'hardware photos, CLI screenshots',
      include_cta: false,
    });
    expect(p.article_preferences.engagement.image_direction).toEqual({
      medium: 'photograph',
      palette: '',
      notes: 'hardware photos, CLI screenshots',
    });
    expect(p.article_preferences.engagement.include_cta).toBe(false);
    expect(p.article_preferences.engagement.youtube_videos).toBe(true);
  });

  test('a document with both keys keeps image_direction', () => {
    const p = withEngagement({
      image_style: 'old',
      image_direction: { medium: 'watercolor', palette: '', notes: 'new' },
    });
    expect(p.article_preferences.engagement.image_direction.notes).toBe('new');
    expect(p.article_preferences.engagement.image_direction.medium).toBe('watercolor');
  });

  test('rejects a medium outside the enum', () => {
    expect(() =>
      withEngagement({ image_direction: { medium: 'oil', palette: '', notes: '' } }),
    ).toThrow();
    expect(() => ImageDirectionSchema.parse({ medium: 'oil', palette: '', notes: '' })).toThrow();
  });

  test('rejects an engagement with neither key', () => {
    expect(() => withEngagement({ include_cta: true })).toThrow();
  });

  test('the enum is the fixed six media', () => {
    expect(IMAGE_MEDIA).toEqual([
      'photograph',
      'flat_illustration',
      'three_d_render',
      'watercolor',
      'line_art',
      'isometric',
    ]);
  });
});
