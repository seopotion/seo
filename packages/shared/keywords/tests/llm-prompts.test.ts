import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildClassifyPrompt,
  buildRelevancePrompt,
  buildSeedPrompt,
  buildSerpJudgmentPrompt,
  parseClassification,
  parseRelevance,
  parseSeeds,
  parseSerpJudgments,
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

describe('buildSerpJudgmentPrompt', () => {
  const items = [
    { keyword: 'dog food', serp: [{ rank: 1, url: 'u', domain: 'd.com', title: 'T' }] },
    { keyword: 'puppy diet', serp: [{ rank: 1, url: 'u2', domain: 'e.com', title: 'U' }] },
  ];

  // Batching is a change to how many keywords share a call, never to what the
  // judge decides — so the criteria sentences must survive verbatim (#211).
  it('carries the intent and locality criteria over unchanged', () => {
    const [system] = buildSerpJudgmentPrompt(items, presets);
    expect(system!.content).toContain(
      'intentSuitable=false if results are product/navigational pages, not informational articles.',
    );
    expect(system!.content).toContain(
      'localitySuitable=false if results are dominated by local businesses/directories for a ' +
        'location that does not match the business country.',
    );
  });

  it('numbers each keyword and keeps its own results with it', () => {
    const [, user] = buildSerpJudgmentPrompt(items, presets);
    expect(user!.content).toContain('Keyword 0: dog food');
    expect(user!.content).toContain('Keyword 1: puppy diet');
    expect(user!.content).toContain('1. T — d.com');
    expect(user!.content).toContain('1. U — e.com');
  });
});

describe('parseSerpJudgments', () => {
  it('reads a verdict per index', () => {
    const { judgments, unparseable, parsed } = parseSerpJudgments(
      '{"judgments":[{"index":0,"intentSuitable":false,"localitySuitable":true,"reason":"nav"},{"index":1,"intentSuitable":true,"localitySuitable":false,"reason":"local"}]}',
      2,
    );
    expect(judgments).toEqual([
      { intentSuitable: false, localitySuitable: true, reason: 'nav' },
      { intentSuitable: true, localitySuitable: false, reason: 'local' },
    ]);
    expect(unparseable).toBe(0);
    expect(parsed).toBe(true);
  });

  // The blast radius rule: batching must not let one bad row decide its
  // neighbours. Row 0 is malformed, row 2 is missing entirely — both fail open,
  // row 1's real verdict survives.
  it('degrades a malformed or missing row per-keyword, not per-batch', () => {
    const { judgments, unparseable, parsed } = parseSerpJudgments(
      '{"judgments":[{"index":0,"intentSuitable":"no","localitySuitable":true},{"index":1,"intentSuitable":false,"localitySuitable":true,"reason":"nav"}]}',
      3,
    );
    expect(judgments[0]).toEqual({ intentSuitable: true, localitySuitable: true, reason: null });
    expect(judgments[1]).toEqual({ intentSuitable: false, localitySuitable: true, reason: 'nav' });
    expect(judgments[2]).toEqual({ intentSuitable: true, localitySuitable: true, reason: null });
    expect(unparseable).toBe(2);
    expect(parsed).toBe(true);
  });

  it('ignores an out-of-range index rather than writing past the batch', () => {
    const { judgments, unparseable } = parseSerpJudgments(
      '{"judgments":[{"index":7,"intentSuitable":false,"localitySuitable":false,"reason":"x"}]}',
      2,
    );
    expect(judgments).toHaveLength(2);
    expect(judgments.every((j) => j.intentSuitable && j.localitySuitable)).toBe(true);
    expect(unparseable).toBe(2);
  });

  // The observed production failure: the model burns its output budget on
  // reasoning and returns "". Every keyword fails open, and `parsed` says so.
  it('fails the whole batch open on an empty body and flags it', () => {
    const { judgments, unparseable, parsed } = parseSerpJudgments('', 3);
    expect(judgments).toHaveLength(3);
    expect(judgments.every((j) => j.intentSuitable && j.localitySuitable)).toBe(true);
    expect(unparseable).toBe(3);
    expect(parsed).toBe(false);
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

describe('buildClassifyPrompt', () => {
  it('numbers the keywords and states the allowed values as exact literals', () => {
    const [system, user] = buildClassifyPrompt(['how to bathe a dog', 'what is kibble'], presets);
    expect(system!.content).toContain('"how_to_guide"');
    expect(system!.content).toContain('"case_study"');
    expect(system!.content).toContain('{"types":[{"index":number,"article_type":string}]}');
    expect(user!.content).toContain('0. how to bathe a dog');
    expect(user!.content).toContain('1. what is kibble');
  });
});

describe('parseClassification', () => {
  it('reads rows by index and normalizes the article_type', () => {
    const { types, coverage } = parseClassification(
      '{"types":[{"index":0,"article_type":"How-To Guide"},{"index":1,"article_type":"tweet"}]}',
      ['how to bathe a dog', 'x', 'missing'],
    );
    expect(types.get('how to bathe a dog')).toBe('how_to_guide');
    expect(types.get('x')).toBe('other');
    expect(types.get('missing')).toBe('other');
    expect(coverage).toEqual({
      sent: 3,
      returned: 2,
      matched: 2,
      typed: 1,
      assigned: 1,
      failedBatches: 0,
    });
  });

  // A model that ignores the index contract and echoes keywords still works —
  // matched through normalizeKeyword, so casing and spacing drift is tolerated.
  it('falls back to matching an echoed keyword, case- and space-insensitively', () => {
    const { types, coverage } = parseClassification(
      '{"types":[{"keyword":"  How To Bathe   A Dog ","article_type":"how_to_guide"}]}',
      ['how to bathe a dog'],
    );
    expect(types.get('how to bathe a dog')).toBe('how_to_guide');
    expect(coverage.matched).toBe(1);
    expect(coverage.assigned).toBe(1);
  });

  // The production failure: an empty body. Every keyword keeps the seed, and the
  // counters are what make that distinguishable from a genuine all-`other` call.
  it('counts an empty body as a dead batch instead of silently seeding other', () => {
    const { types, coverage } = parseClassification('', ['a', 'b']);
    expect(types.get('a')).toBe('other');
    expect(coverage).toEqual({
      sent: 2,
      returned: 0,
      matched: 0,
      typed: 0,
      assigned: 0,
      failedBatches: 1,
    });
  });

  it('separates a keyword miss from an article_type miss in the counters', () => {
    const { coverage } = parseClassification(
      '{"types":[{"index":9,"article_type":"listicle"},{"index":0,"article_type":"nonsense"}]}',
      ['a'],
    );
    expect(coverage.returned).toBe(2);
    expect(coverage.matched).toBe(1);
    expect(coverage.typed).toBe(1);
    expect(coverage.assigned).toBe(0);
  });
});
