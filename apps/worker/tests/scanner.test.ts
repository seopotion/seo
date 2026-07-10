import { SetupPresetsSchema } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { scanWebsite } from '../src/scanner';

describe('scanWebsite', () => {
  test('does not generate placeholder business, competitor, or blog data', async () => {
    const presets = await scanWebsite('https://www.clewas.com/');

    expect(presets.business).toEqual({ name: '', language: '', country: '', description: '' });
    expect(presets.audience).toEqual({ target: '', competitors: [] });
    expect(presets.blog).toEqual({ sitemap_url: '', main_blog_url: '', best_articles: [] });
  });

  test('output validates against SetupPresetsSchema', async () => {
    const presets = await scanWebsite('https://example.org');
    expect(() => SetupPresetsSchema.parse(presets)).not.toThrow();
  });

  test('falls back gracefully for an invalid URL', async () => {
    const presets = await scanWebsite('not a url');
    expect(presets.business.name).toBe('');
  });
});
