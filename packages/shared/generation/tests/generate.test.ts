import type { LlmClient, LlmMessage } from '@shared/providers';
import { describe, expect, test, vi } from 'vitest';
import { generateArticle } from '../src/generate';
import type { GenerationContext } from '../src/types';

const ctx: GenerationContext = {
  businessName: 'Acme',
  businessDescription: 'widgets',
  language: 'English',
  country: 'US',
  audience: 'makers',
  competitors: [],
  articleStyle: 'practical',
  maxInternalLinks: 0,
  linkCandidates: [],
  llmInstructions: '',
  keyword: 'best widgets',
  articleType: 'listicle',
  intent: 'commercial',
  serpCompetitors: [],
};

const outlineJson = JSON.stringify({
  h1: 'Best Widgets For Makers',
  meta_title: 'Best Widgets For Makers 2026',
  meta_description: 'x'.repeat(140),
  slug: 'best-widgets',
  sections: [
    { heading: 'One', intent: 'i' },
    { heading: 'Two', intent: 'i' },
  ],
});

// Fixture must clear WORD_COUNT_FLOOR (800): 80 intro + 2 x 400 section words = ~886.
const articleMd = `# Best Widgets For Makers\n\n${'Intro paragraph words here. '.repeat(20)}\n\n## One\n\n${'Body one content unique. '.repeat(100)}\n\n## Two\n\n${'Body two content unique. '.repeat(100)}\n`;

/** Returns an LlmClient whose complete() replies in call order. */
function mockLlm(replies: string[]): LlmClient {
  let i = 0;
  return {
    complete: vi.fn(async (_p: { messages: LlmMessage[] }) => ({
      text: replies[i++]!,
      model: 'test',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0.01 },
    })),
  };
}

describe('generateArticle', () => {
  test('happy path returns a valid article and summed usage', async () => {
    // order: outline, article, humanize, semantic
    const llm = mockLlm([outlineJson, articleMd, articleMd, '{"pass":true,"reasons":[]}']);
    const result = await generateArticle({ ctx, llm });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.article.title).toBe('Best Widgets For Makers');
      expect(result.article.meta_title).toBe('Best Widgets For Makers 2026');
      expect(result.article.usage.totalTokens).toBe(8); // 4 calls x 2
      expect(result.article.usage.costUsd).toBeCloseTo(0.04);
    }
  });

  test('semantic failure returns ok:false with a semantic failure', async () => {
    const llm = mockLlm([
      outlineJson,
      articleMd,
      articleMd,
      '{"pass":false,"reasons":["promotes rival"]}',
    ]);
    const result = await generateArticle({ ctx, llm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.map((f) => f.code)).toContain('semantic');
  });

  test('deterministic failure (short article) returns ok:false', async () => {
    const shortMd = '# T\n\nintro\n\n## A\n\nshort\n\n## B\n\nalso';
    const llm = mockLlm([outlineJson, shortMd, shortMd, '{"pass":true}']);
    const result = await generateArticle({ ctx, llm });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failures.map((f) => f.code)).toContain('word_count');
  });

  test('provider error bubbles up', async () => {
    const llm: LlmClient = {
      complete: vi.fn(async () => {
        throw new Error('rate limited');
      }),
    };
    await expect(generateArticle({ ctx, llm })).rejects.toThrow('rate limited');
  });

  test('strips a link the model invented despite the prompt (#186)', async () => {
    const linked: GenerationContext = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [{ title: 'Guide', url: 'https://a.com/blog/guide' }],
    };
    const outlineWithLink = JSON.stringify({
      ...JSON.parse(outlineJson),
      internal_links: ['https://a.com/blog/guide'],
    });
    const md = `${articleMd}\nRead our [guide](https://a.com/blog/guide) and our [pricing](/pricing/invented).\n`;
    const llm = mockLlm([outlineWithLink, md, md, '{"pass":true,"reasons":[]}']);

    const result = await generateArticle({ ctx: linked, llm });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.article.content).toContain('[guide](https://a.com/blog/guide)');
      expect(result.article.content).not.toContain('/pricing/invented');
      expect(result.article.content).toContain('pricing');
    }
  });

  test('with no candidates every link is stripped (#186)', async () => {
    const md = `${articleMd}\nSee [features](/features/invented) and [this](#).\n`;
    const llm = mockLlm([outlineJson, md, md, '{"pass":true,"reasons":[]}']);

    const result = await generateArticle({ ctx, llm });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.article.content).not.toContain('](');
      expect(result.article.content).toContain('features');
    }
  });
});
