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
    engagement: { image_style: 'Clean, minimal' },
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

  test('coerces a string audience target from the LLM into a single-element array', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const stringTarget = JSON.parse(LLM_JSON);
    stringTarget.audience = { target: 'SEO founders, and marketers' };
    const llm = llmReturning(JSON.stringify(stringTarget));

    const presets = await scanWebsite('https://clewas.com', { llm });

    expect(presets.audience.target).toEqual(['SEO founders, and marketers']);
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
