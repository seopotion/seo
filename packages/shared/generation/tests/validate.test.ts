import { describe, expect, test } from 'vitest';
import type { GenerationContext } from '../src/types';
import { countWords, validateArticle } from '../src/validate';

const ctx = {
  keyword: 'best widgets',
  maxInternalLinks: 0,
  linkCandidates: [],
} as unknown as GenerationContext;

// Fixture must clear WORD_COUNT_FLOOR (800): 140 intro + 2 x 360 section words = ~868.
const goodBody = `# Best Widgets For Makers\n\n${'An intro paragraph with plenty of words. '.repeat(20)}\n\n## Section One\n\n${'Unique body content number one here. '.repeat(60)}\n\n## Section Two\n\n${'Distinct body content number two here. '.repeat(60)}\n`;

const goodArticle = {
  title: 'Best Widgets For Makers',
  meta_title: 'Best Widgets For Makers in 2026',
  meta_description: 'A'.repeat(140),
  content: goodBody,
};

describe('validateArticle', () => {
  test('a well-formed article has no failures', () => {
    expect(validateArticle(goodArticle, ctx)).toEqual([]);
  });

  test('title identical to keyword fails', () => {
    const codes = validateArticle(
      { ...goodArticle, title: 'Best Widgets' },
      {
        ...ctx,
        keyword: 'best widgets',
      },
    ).map((f) => f.code);
    expect(codes).toContain('title_equals_keyword');
  });

  test('short article fails word_count', () => {
    const codes = validateArticle(
      { ...goodArticle, content: '# Title\n\nintro\n\n## A\n\nshort\n\n## B\n\nalso' },
      ctx,
    ).map((f) => f.code);
    expect(codes).toContain('word_count');
  });

  test('meta length and heading structure fail', () => {
    const codes = validateArticle(
      {
        title: 'X',
        meta_title: 'y'.repeat(70),
        meta_description: 'too short',
        content: `## Only H2\n\n${'body '.repeat(200)}`,
      },
      ctx,
    ).map((f) => f.code);
    expect(codes).toContain('meta_title_length');
    expect(codes).toContain('meta_description_length');
    expect(codes).toContain('h1_count');
    expect(codes).toContain('h2_count');
  });

  test('empty and duplicate sections fail', () => {
    const dup = `# T\n\n${'intro '.repeat(20)}\n\n## A\n\nsame body text repeated exactly here now\n\n## B\n\nsame body text repeated exactly here now\n`;
    const codes = validateArticle({ ...goodArticle, content: dup }, ctx).map((f) => f.code);
    expect(codes).toContain('duplicate_section');
  });

  test('countWords ignores markdown punctuation', () => {
    expect(countWords('# Hello **world**')).toBe(2);
  });
});
