import { describe, expect, test } from 'vitest';
import type { GenerationContext } from '../src/types';
import { countWords, validateArticle } from '../src/validate';
import { buildVideoEmbed } from '../src/video';

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

  test('an unapproved link fails illegal_link (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [{ title: 'One', url: 'https://a.com/blog/one' }],
    } as GenerationContext;
    const content = `${goodBody}\n\nsee [features](/features/invented)\n`;
    const codes = validateArticle({ ...goodArticle, content }, linked).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('an approved link within the ceiling passes (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [{ title: 'One', url: 'https://a.com/blog/one' }],
    } as GenerationContext;
    const content = `${goodBody}\n\nsee [our guide](https://a.com/blog/one)\n`;
    expect(validateArticle({ ...goodArticle, content }, linked)).toEqual([]);
  });

  test('more links than the ceiling fails illegal_link (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [
        { title: 'One', url: 'https://a.com/blog/one' },
        { title: 'Two', url: 'https://a.com/blog/two' },
      ],
    } as GenerationContext;
    const content = `${goodBody}\n\n[a](https://a.com/blog/one) [b](https://a.com/blog/two)\n`;
    const codes = validateArticle({ ...goodArticle, content }, linked).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('an image URL is not treated as a link (#186)', () => {
    const content = `${goodBody}\n\n![cover](https://cdn.seopotion.co/x.webp)\n`;
    expect(validateArticle({ ...goodArticle, content }, ctx)).toEqual([]);
  });

  test('a single-quoted-title link is seen by the backstop (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [{ title: 'One', url: 'https://a.com/blog/one' }],
    } as GenerationContext;
    const content = `${goodBody}\n\nsee [our sizing guide](/guides/sizing 'Sizing Guide')\n`;
    const codes = validateArticle({ ...goodArticle, content }, linked).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('a candidate that was not selected fails the narrowed backstop (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 2,
      linkCandidates: [
        { title: 'One', url: 'https://a.com/blog/one' },
        { title: 'Two', url: 'https://a.com/blog/two' },
      ],
    } as GenerationContext;
    const content = `${goodBody}\n\nsee [two](https://a.com/blog/two)\n`;
    // Wide default (every candidate) passes; the set the sanitizer enforced does not.
    expect(validateArticle({ ...goodArticle, content }, linked)).toEqual([]);
    const codes = validateArticle({ ...goodArticle, content }, linked, [
      'https://a.com/blog/one',
    ]).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('a raw HTML anchor fails illegal_link (#186)', () => {
    const content = `${goodBody}\n\n<a href="#">click</a>\n`;
    const codes = validateArticle({ ...goodArticle, content }, ctx).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('an autolink fails illegal_link (#186)', () => {
    const content = `${goodBody}\n\nsee <https://example.com/page>\n`;
    const codes = validateArticle({ ...goodArticle, content }, ctx).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('a reference-link definition fails illegal_link (#186)', () => {
    const content = `${goodBody}\n\n[ref]: /guides/sizing\n`;
    const codes = validateArticle({ ...goodArticle, content }, ctx).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('the injected YouTube iframe does not trip the anchor check (#186)', () => {
    const content = `${goodBody}\n\n${buildVideoEmbed('abc123', 'A & B "video"')}\n`;
    expect(validateArticle({ ...goodArticle, content }, ctx)).toEqual([]);
  });
});
