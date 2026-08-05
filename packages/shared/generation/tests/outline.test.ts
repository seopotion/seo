import { describe, expect, test } from 'vitest';
import { buildOutlinePrompt, parseOutline } from '../src/outline';
import type { GenerationContext } from '../src/types';

const ctx: GenerationContext = {
  businessName: 'Acme',
  businessDescription: 'We sell widgets',
  language: 'English',
  country: 'US',
  audience: 'makers',
  competitors: ['rival.com'],
  articleStyle: 'practical',
  maxInternalLinks: 0,
  linkCandidates: [],
  llmInstructions: 'be concise',
  keyword: 'best widgets',
  articleType: 'listicle',
  intent: 'commercial',
  serpCompetitors: [
    { rank: 1, url: 'https://a.com/best-widgets', domain: 'a.com', title: 'Top 10 Widgets' },
  ],
};

describe('outline', () => {
  test('buildOutlinePrompt includes keyword, language, and JSON instruction', () => {
    const msgs = buildOutlinePrompt(ctx);
    expect(msgs[0]!.role).toBe('system');
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('best widgets');
    expect(joined).toContain('English');
    expect(joined.toLowerCase()).toContain('json');
  });

  test('buildOutlinePrompt lists ranking SERP articles with title and url (#144)', () => {
    const joined = buildOutlinePrompt(ctx)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('Top 10 Widgets');
    expect(joined).toContain('https://a.com/best-widgets');
  });

  test('buildOutlinePrompt falls back to domain for legacy entries without title (#144)', () => {
    const legacy = {
      ...ctx,
      serpCompetitors: [{ rank: null, url: null, domain: 'a.com', title: null }],
    };
    const joined = buildOutlinePrompt(legacy)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('a.com');
  });

  test('parseOutline parses fenced JSON and applies defaults', () => {
    const out = parseOutline(
      '```json\n{"h1":"Best Widgets Ranked","meta_title":"t","meta_description":"d","slug":"best-widgets","sections":[{"heading":"H","intent":"i"}]}\n```',
    );
    expect(out.h1).toBe('Best Widgets Ranked');
    expect(out.faqs).toEqual([]);
    expect(out.internal_links).toEqual([]);
  });

  test('parseOutline rejects an outline with no sections', () => {
    expect(() =>
      parseOutline('{"h1":"x","meta_title":"t","meta_description":"d","slug":"s","sections":[]}'),
    ).toThrow();
  });
});
