import { SetupPresetsSchema } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { scanWebsite } from '../src/scanner';

describe('scanWebsite (mock)', () => {
  test('derives brand and URLs from the website host', async () => {
    const presets = await scanWebsite('https://www.clewas.com/');

    expect(presets.business.name).toBe('Clewas');
    expect(presets.blog.sitemap_url).toBe('https://clewas.com/sitemap.xml');
    expect(presets.blog.main_blog_url).toBe('https://clewas.com/blog');
    expect(presets.article_preferences.content_seo.internal_links).toBe(true);
  });

  test('output validates against SetupPresetsSchema', async () => {
    const presets = await scanWebsite('https://example.org');
    expect(() => SetupPresetsSchema.parse(presets)).not.toThrow();
  });

  test('falls back gracefully for an invalid URL', async () => {
    const presets = await scanWebsite('not a url');
    expect(presets.business.name).toBe('Example');
  });
});
