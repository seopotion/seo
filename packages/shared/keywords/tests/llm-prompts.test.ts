import type { SetupPresets } from '@shared/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildRelevancePrompt,
  buildSeedPrompt,
  parseClassification,
  parseRelevance,
  parseSeeds,
  parseSerpJudgment,
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
});

describe('parseSeeds', () => {
  it('reads a seeds array', () => {
    expect(parseSeeds('{"seeds":["dog food","puppy diet"]}')).toEqual(['dog food', 'puppy diet']);
  });
  it('returns [] on garbage', () => {
    expect(parseSeeds('not json')).toEqual([]);
  });
});

describe('parseRelevance', () => {
  it('maps and clamps scores, defaulting missing to 0', () => {
    const { scores, returned } = parseRelevance(
      '{"scores":[{"keyword":"dog food","relevance":1.4}]}',
      ['dog food', 'x'],
    );
    expect(scores.get('dog food')).toBe(1);
    expect(scores.get('x')).toBe(0);
    // "x" was never judged — it only has the seed, which `returned` excludes.
    expect(returned).toBe(1);
  });
});

describe('parseSerpJudgment', () => {
  it('parses a decision', () => {
    expect(
      parseSerpJudgment('{"intentSuitable":false,"localitySuitable":true,"reason":"nav"}'),
    ).toEqual({
      intentSuitable: false,
      localitySuitable: true,
      reason: 'nav',
    });
  });
  it('fails open on garbage', () => {
    expect(parseSerpJudgment('oops')).toEqual({
      intentSuitable: true,
      localitySuitable: true,
      reason: null,
    });
  });
});

describe('parseClassification', () => {
  it('validates against the enum and defaults unknowns to other', () => {
    const m = parseClassification(
      '{"types":[{"keyword":"how to bathe a dog","article_type":"how_to_guide"},{"keyword":"x","article_type":"tweet"}]}',
      ['how to bathe a dog', 'x', 'missing'],
    );
    expect(m.get('how to bathe a dog')).toBe('how_to_guide');
    expect(m.get('x')).toBe('other');
    expect(m.get('missing')).toBe('other');
  });
});

describe('buildRelevancePrompt', () => {
  it('includes business context and the keyword list', () => {
    const msgs = buildRelevancePrompt(['dog food'], presets);
    expect(msgs[0]!.role).toBe('system');
    expect(JSON.stringify(msgs)).toContain('dog food');
    expect(JSON.stringify(msgs)).toContain('pet food');
  });
});
