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

const withCandidates = (max: number): GenerationContext => ({
  ...ctx,
  maxInternalLinks: max,
  linkCandidates: [
    { title: 'Widget Guide', url: 'https://a.com/blog/widget-guide' },
    { title: 'Widget Care', url: 'https://a.com/blog/widget-care' },
  ],
});

const outlineJson = (internal_links: string[]) =>
  JSON.stringify({
    h1: 'Best Widgets Ranked',
    meta_title: 't',
    meta_description: 'd',
    slug: 'best-widgets',
    sections: [{ heading: 'H', intent: 'i' }],
    internal_links,
  });

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

  test('buildOutlinePrompt lists candidates with their exact URLs and the ceiling (#186)', () => {
    const joined = buildOutlinePrompt(withCandidates(2))
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('https://a.com/blog/widget-guide');
    expect(joined).toContain('Widget Guide');
    expect(joined).toContain('at most 2');
  });

  test('buildOutlinePrompt tells the model there is nothing to link when there are no candidates (#186)', () => {
    const joined = buildOutlinePrompt(ctx)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('no internal link candidates');
  });

  test('parseOutline parses fenced JSON and applies defaults', () => {
    const out = parseOutline(
      '```json\n{"h1":"Best Widgets Ranked","meta_title":"t","meta_description":"d","slug":"best-widgets","sections":[{"heading":"H","intent":"i"}]}\n```',
      ctx,
    );
    expect(out.h1).toBe('Best Widgets Ranked');
    expect(out.faqs).toEqual([]);
    expect(out.internal_links).toEqual([]);
  });

  test('parseOutline rejects an outline with no sections', () => {
    expect(() =>
      parseOutline(
        '{"h1":"x","meta_title":"t","meta_description":"d","slug":"s","sections":[]}',
        ctx,
      ),
    ).toThrow();
  });

  test('parseOutline keeps candidate URLs and drops invented ones (#186)', () => {
    const out = parseOutline(
      outlineJson(['https://a.com/blog/widget-guide', '/features/invented', '#']),
      withCandidates(3),
    );
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline caps at maxInternalLinks and de-duplicates (#186)', () => {
    const out = parseOutline(
      outlineJson([
        'https://a.com/blog/widget-guide',
        'https://a.com/blog/widget-guide',
        'https://a.com/blog/widget-care',
      ]),
      withCandidates(1),
    );
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline canonicalizes a trailing-slash variant to our URL (#186)', () => {
    const out = parseOutline(outlineJson(['https://a.com/blog/widget-guide/']), withCandidates(2));
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline yields no links when there are no candidates (#186)', () => {
    const out = parseOutline(outlineJson(['https://a.com/blog/widget-guide']), ctx);
    expect(out.internal_links).toEqual([]);
  });
});
