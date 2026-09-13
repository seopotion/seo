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
      readability_grade_max: 10,
      content_complexity: 'professional',
      llm_instructions: 'Be clear.',
    },
    engagement: {
      image_direction: { medium: 'flat_illustration', palette: 'teal and white', notes: '' },
    },
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
    expect(presets.article_preferences.engagement.image_direction).toEqual({
      medium: 'flat_illustration',
      palette: 'teal and white',
      notes: '',
    });
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

  // #312: the medium is a structured-output enum, so the model cannot invent one.
  test('constrains image_direction.medium to the enum in the response schema', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    await scanWebsite('https://clewas.com', { llm });

    const { responseSchema } = llm.complete.mock.calls[0]![0];
    const schema = JSON.stringify(responseSchema?.schema);
    expect(schema).toContain('"image_direction"');
    expect(schema).toContain('"flat_illustration"');
    expect(schema).not.toContain('image_style');
    const system = String(llm.complete.mock.calls[0]![0].messages[0]!.content);
    expect(system).toContain('medium');
    expect(system).toContain('palette');
    expect(system).toContain('notes');
  });

  test('rejects a medium outside the enum', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const bad = JSON.parse(LLM_JSON);
    bad.article_preferences.engagement.image_direction.medium = 'screenshot';

    await expect(
      scanWebsite('https://clewas.com', { llm: llmReturning(JSON.stringify(bad)) }),
    ).rejects.toThrow();
  });

  test('asks for a readability tier and lands it in presets (#313)', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    const presets = await scanWebsite('https://clewas.com', { llm });

    const system = llm.complete.mock.calls[0]![0].messages[0]!.content;
    expect(system).toContain('readability_grade_max');
    expect(system).toContain('8 for general-public');
    expect(system).toContain('12 for developers');
    expect(presets.article_preferences.content_seo.readability_grade_max).toBe(10);

    // The constraint must reach the provider, not just the post-parse (#313).
    const { responseSchema } = llm.complete.mock.calls[0]![0];
    const contentSeo = (
      (
        responseSchema?.schema.properties as Record<
          string,
          { properties?: Record<string, unknown> }
        >
      ).article_preferences?.properties as Record<string, { properties?: Record<string, unknown> }>
    ).content_seo?.properties as Record<string, unknown>;
    expect(contentSeo.readability_grade_max).toEqual({ type: 'number', enum: [8, 10, 12] });
  });

  test('rejects a readability tier outside 8 / 10 / 12 (#313)', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const off = JSON.parse(LLM_JSON);
    off.article_preferences.content_seo.readability_grade_max = 9;

    await expect(
      scanWebsite('https://clewas.com', { llm: llmReturning(JSON.stringify(off)) }),
    ).rejects.toThrow();
  });

  test('asks for a content complexity and lands it in presets', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    const presets = await scanWebsite('https://clewas.com', { llm });

    const system = String(llm.complete.mock.calls[0]![0].messages[0]!.content);
    expect(system).toContain('content_complexity');
    expect(system).toContain('general for consumer');
    expect(system).toContain('technical for developer tools');
    expect(presets.article_preferences.content_seo.content_complexity).toBe('professional');

    const schema = JSON.stringify(llm.complete.mock.calls[0]![0].responseSchema?.schema);
    expect(schema).toContain('"content_complexity"');
    expect(schema).toContain('"technical"');
  });

  test('rejects a content complexity outside the enum', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const off = JSON.parse(LLM_JSON);
    off.article_preferences.content_seo.content_complexity = 'expert';

    await expect(
      scanWebsite('https://clewas.com', { llm: llmReturning(JSON.stringify(off)) }),
    ).rejects.toThrow();
  });

  test('describes when diagram is the medium and keeps screenshots out', async () => {
    fetchSite.mockResolvedValue({ text: 'x', links: [] });
    const llm = llmReturning(LLM_JSON);

    await scanWebsite('https://clewas.com', { llm });

    const system = String(llm.complete.mock.calls[0]![0].messages[0]!.content);
    expect(system).toContain('diagram for developer tools');
    expect(system).toContain('Screenshots and real interfaces are never a medium');
    expect(system).not.toContain('Screenshots, diagrams and interfaces are never a medium');
    const schema = JSON.stringify(llm.complete.mock.calls[0]![0].responseSchema?.schema);
    expect(schema).toContain('"diagram"');
  });
});
