import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildRelevancePrompt,
  buildSeedPrompt,
  parseRelevance,
  parseSeeds,
  toArticleType,
} from '../src/llm-prompts';

const presets = {
  business: {
    name: 'Acme',
    language: 'English',
    country: 'United States',
    description: 'pet food',
  },
  audience: { target: ['dog owners'], competitors: [] },
  blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
  article_preferences: {
    content_seo: {
      article_style: '',
      internal_links_count: 0,
      table_of_contents: true,
      llm_instructions: '',
    },
    engagement: { image_style: '', youtube_videos: true },
    publishing: { auto_publish: false },
  },
} satisfies SetupPresets;

describe('buildSeedPrompt', () => {
  it('includes competitor wins in the user message when provided', () => {
    const [, user] = buildSeedPrompt(presets, ['grain free dog food', 'raw diet for puppies']);
    expect(user!.content).toContain('grain free dog food');
    expect(user!.content).toContain('raw diet for puppies');
  });

  it('omits the competitor-wins section when there are none', () => {
    const [, user] = buildSeedPrompt(presets, []);
    expect(user!.content).not.toContain('competitors');
  });

  // The rewrite (#211) only changes the instruction text; the JSON contract has
  // to stay exactly what parseSeeds reads, or gather silently produces no seeds.
  it('keeps the {"seeds": string[]} contract parseSeeds expects', () => {
    const [system] = buildSeedPrompt(presets, []);
    expect(system!.content).toContain('{"seeds": string[]}');
    expect(parseSeeds('{"seeds":["membrane fouling","antiscalant dosing"]}')).toEqual([
      'membrane fouling',
      'antiscalant dosing',
    ]);
  });

  it('asks for buyer vocabulary rather than generic category seeds', () => {
    const [system] = buildSeedPrompt(presets, []);
    expect(system!.content).toMatch(/technical vocabulary/i);
    expect(system!.content).toMatch(/failure modes|problem/i);
    expect(system!.content).not.toMatch(/generic/i);
  });
});

describe('parseSeeds', () => {
  it('reads a seeds array', () => {
    expect(parseSeeds('{"seeds":["dog food","puppy diet"]}')).toEqual(['dog food', 'puppy diet']);
  });
  it('returns [] on garbage', () => {
    expect(parseSeeds('not json')).toEqual([]);
  });
});

describe('buildRelevancePrompt', () => {
  it('includes business context and the keyword list', () => {
    const msgs = buildRelevancePrompt(['dog food'], presets);
    expect(msgs[0]!.role).toBe('system');
    expect(JSON.stringify(msgs)).toContain('dog food');
    expect(JSON.stringify(msgs)).toContain('pet food');
  });

  it('numbers the keywords and asks for answers by index, not by echo', () => {
    const [system, user] = buildRelevancePrompt(['dog food', 'puppy diet'], presets);
    expect(system!.content).toContain('answer by that index');
    expect(system!.content).toContain('{"scores":[{"index":number,"relevance":number}]}');
    expect(user!.content).toContain('0. dog food');
    expect(user!.content).toContain('1. puppy diet');
  });

  // The scoring criterion is the thing that must not drift; only the addressing
  // changed when the call was batched (#211).
  it('keeps the scoring criterion verbatim', () => {
    const [system] = buildRelevancePrompt(['dog food'], presets);
    expect(system!.content).toContain(
      'Score each keyword 0..1 for how relevant it is to the business and audience.',
    );
  });
});

describe('parseRelevance', () => {
  it('reads rows by index and clamps to 0..1', () => {
    const { scores, parsed } = parseRelevance(
      '{"scores":[{"index":0,"relevance":1.4},{"index":1,"relevance":-2}]}',
      ['dog food', 'x'],
    );
    expect(scores.get('dog food')).toBe(1);
    expect(scores.get('x')).toBe(0);
    expect(parsed).toBe(true);
  });

  // The whole point of the null-vs-zero split: an absent keyword must be ABSENT,
  // not seeded to 0, because the relevance floor rejects at 0 (#211).
  it('omits keywords the model never answered instead of seeding them to 0', () => {
    const { scores } = parseRelevance('{"scores":[{"index":0,"relevance":0.5}]}', [
      'dog food',
      'never judged',
    ]);
    expect(scores.has('never judged')).toBe(false);
    expect(scores.size).toBe(1);
  });

  it('still honours an echoed keyword, case-insensitively, when the model ignores the index', () => {
    const { scores } = parseRelevance('{"scores":[{"keyword":"Dog  Food","relevance":0.5}]}', [
      'dog food',
    ]);
    expect(scores.get('dog food')).toBe(0.5);
  });

  it('drops a malformed row without losing its neighbours', () => {
    const { scores } = parseRelevance(
      '{"scores":[{"index":0,"relevance":"high"},{"index":1,"relevance":0.7},{"index":9,"relevance":0.1}]}',
      ['a', 'b'],
    );
    expect([...scores]).toEqual([['b', 0.7]]);
  });

  // Every parser shares tryParse, so a fenced body broke all of them at once —
  // it is why the Haiku A/B arm scored 0 of 340 keywords (#211).
  it('reads a body wrapped in a markdown code fence', () => {
    const fenced = '```json\n{"scores":[{"index":0,"relevance":0.5}]}\n```';
    expect(parseRelevance(fenced, ['a']).scores.get('a')).toBe(0.5);
    expect(
      parseRelevance('```\n{"scores":[{"index":0,"relevance":1}]}\n```', ['a']).scores.get('a'),
    ).toBe(1);
  });

  it('reports an empty or unparseable body as unparsed', () => {
    expect(parseRelevance('', ['a']).parsed).toBe(false);
    expect(parseRelevance('not json', ['a']).scores.size).toBe(0);
    expect(parseRelevance('{"scores":[]}', ['a']).parsed).toBe(false);
  });
});

describe('toArticleType', () => {
  // The enum is snake_case; models write prose. The old exact-match check sent
  // every one of these to `other` silently (#211).
  it('resolves casing and separator drift onto the enum', () => {
    expect(toArticleType('How-To Guide')).toBe('how_to_guide');
    expect(toArticleType('how to guide')).toBe('how_to_guide');
    expect(toArticleType('  PRODUCT_GUIDE ')).toBe('product_guide');
    expect(toArticleType('Case-Study')).toBe('case_study');
  });

  it('rejects a value that is not an article type', () => {
    expect(toArticleType('tweet')).toBeNull();
    expect(toArticleType('')).toBeNull();
  });
});
