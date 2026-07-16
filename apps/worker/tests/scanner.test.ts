import type { LlmCompleteParams } from '@shared/providers';
import { SetupPresetsSchema } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { fetchSite, discoverBlog } = vi.hoisted(() => ({
  fetchSite: vi.fn(),
  discoverBlog: vi.fn(),
}));
vi.mock('../src/scrape', () => ({ fetchSite, discoverBlog }));

import { scanWebsite } from '../src/scanner';

describe('scanWebsite', () => {
  test('does not generate placeholder business, competitor, or blog data', async () => {
    const presets = await scanWebsite('https://www.clewas.com/');

    expect(presets.business).toEqual({ name: '', language: '', country: '', description: '' });
    expect(presets.audience).toEqual({ target: '', competitors: [] });
    expect(presets.blog).toEqual({ sitemap_url: '', main_blog_url: '', best_articles: [] });
  });

  test('completes with a valid preset when the homepage cannot be fetched', async () => {
    fetchSite.mockResolvedValue(null);
    const llm = llmReturning(LLM_JSON);

    const presets = await scanWebsite('https://clewas.com', { llm });

    expect(() => SetupPresetsSchema.parse(presets)).not.toThrow();
    const userMessage = llm.complete.mock.calls[0]![0].messages[1]!.content;
    expect(userMessage).toContain('clewas.com');
  });

  test('falls back gracefully for an invalid URL', async () => {
    const presets = await scanWebsite('not a url');
    expect(presets.business.name).toBe('');
  });
});
