import type { LlmCompleteParams } from '@shared/providers';
import { SetupPresetsSchema } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { fetchSite, discoverBlog } = vi.hoisted(() => ({
  fetchSite: vi.fn(),
  discoverBlog: vi.fn(),
}));
vi.mock('../src/scrape', () => ({ fetchSite, discoverBlog }));

import { scanWebsite } from '../src/scanner';

const LLM_JSON = JSON.stringify({
  business: {
    name: 'Clewas',
    language: 'English',
    country: 'Global (English)',
    description: 'Clewas helps teams improve search visibility.',
  },
  audience: { target: ['Founders comparing SEO solutions.'] },
  article_preferences: {
    content_seo: {
      article_style: 'Practical',
      llm_instructions: 'Be clear.',
    },
    engagement: { image_direction: { medium: 'photograph', palette: '', notes: '' } },
  },
});

const BLOG = {
  sitemap_url: 'https://clewas.com/sitemap.xml',
  main_blog_url: 'https://clewas.com/blog',
  best_articles: ['https://clewas.com/blog/post-1'],
};

/** A fake LlmClient whose `complete` returns the given text. */
function llmReturning(text: string) {
  return {
    complete: vi.fn(async (_params: LlmCompleteParams) => ({
      text,
      model: 'test-model',
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: null },
    })),
  };
}

beforeEach(() => {
  fetchSite.mockReset();
  discoverBlog.mockReset();
  discoverBlog.mockResolvedValue(BLOG);
});

describe('scanWebsite', () => {
  test('assembles presets from scrape + LLM; competitors empty, blog from sitemap', async () => {
    fetchSite.mockResolvedValue({ text: 'Clewas helps with SEO', links: [] });
    const llm = llmReturning(LLM_JSON);

    const presets = await scanWebsite('https://clewas.com', { llm });

    expect(() => SetupPresetsSchema.parse(presets)).not.toThrow();
    expect(presets.business.name).toBe('Clewas');
    expect(presets.audience.target).toEqual(['Founders comparing SEO solutions.']);
    expect(presets.audience.competitors).toEqual([]);
    expect(presets.blog).toEqual(BLOG);
  });

  test('constrains the response to the presets schema', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    await scanWebsite('https://clewas.com', { llm });

    const { responseSchema } = llm.complete.mock.calls[0]![0];
    expect(responseSchema?.name).toBe('setup_presets');
    // The field whose absence dead-lettered a production scan.
    const audience = (responseSchema?.schema.properties as Record<string, { required?: string[] }>)
      .audience;
    expect(audience?.required).toEqual(['target']);
  });

  test('trims an over-long audience target rather than failing the scan', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    // The 7-segment cap is a presets rule strict mode cannot express, so an
    // over-eager model must not be able to fail the whole scan on it.
    const tooMany = JSON.parse(LLM_JSON);
    tooMany.audience = { target: Array.from({ length: 12 }, (_, i) => `segment ${i}`) };

    const presets = await scanWebsite('https://clewas.com', {
      llm: llmReturning(JSON.stringify(tooMany)),
    });

    expect(presets.audience.target).toHaveLength(7);
  });

  test('rejects a response missing a schema-required field', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const missing = JSON.parse(LLM_JSON);
    delete missing.audience;

    await expect(
      scanWebsite('https://clewas.com', { llm: llmReturning(JSON.stringify(missing)) }),
    ).rejects.toThrow();
  });

  test('completes with a valid preset when the homepage cannot be fetched', async () => {
    fetchSite.mockResolvedValue(null);
    const llm = llmReturning(LLM_JSON);

    const presets = await scanWebsite('https://clewas.com', { llm });

    expect(() => SetupPresetsSchema.parse(presets)).not.toThrow();
    const userMessage = llm.complete.mock.calls[0]![0].messages[1]!.content;
    expect(userMessage).toContain('clewas.com');
  });

  test('rejects when the LLM returns invalid JSON', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });

    await expect(
      scanWebsite('https://clewas.com', { llm: llmReturning('not json') }),
    ).rejects.toThrow();
  });
});
