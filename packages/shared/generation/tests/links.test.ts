import type { Keyword, Org } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { buildContext } from '../src/context';
import {
  deriveCandidates,
  extractLinks,
  normalizeUrl,
  publishedArticleUrl,
  sanitizeLinks,
} from '../src/links';

describe('normalizeUrl', () => {
  test('trims whitespace and trailing slashes', () => {
    expect(normalizeUrl(' https://a.com/blog/x/ ')).toBe('https://a.com/blog/x');
    expect(normalizeUrl('https://a.com/blog/x')).toBe('https://a.com/blog/x');
  });
});

describe('publishedArticleUrl', () => {
  test('joins base and slug with exactly one slash', () => {
    expect(publishedArticleUrl('https://a.com/blog/', 'my-post')).toBe(
      'https://a.com/blog/my-post',
    );
    expect(publishedArticleUrl('https://a.com/blog', '/my-post/')).toBe(
      'https://a.com/blog/my-post',
    );
  });

  test('returns null for an empty base, empty slug, or non-http base', () => {
    expect(publishedArticleUrl('', 'my-post')).toBeNull();
    expect(publishedArticleUrl('https://a.com/blog', '')).toBeNull();
    expect(publishedArticleUrl('not a url', 'my-post')).toBeNull();
    expect(publishedArticleUrl('ftp://a.com', 'my-post')).toBeNull();
  });

  test('returns null when the base carries a query or fragment', () => {
    // Appending a slug to these yields `…?page=2/my-post` — not a page URL.
    expect(publishedArticleUrl('https://a.com/blog?page=2', 'my-post')).toBeNull();
    expect(publishedArticleUrl('https://a.com/blog#latest', 'my-post')).toBeNull();
  });
});

describe('deriveCandidates', () => {
  const pub = (slug: string, published_at: Date) => ({ slug, published_at });

  test('uses the most recent publication slug, not article.slug', () => {
    const got = deriveCandidates('https://a.com/blog', [
      {
        title: 'Post One',
        slug: 'edited-after-publish',
        publications: [
          pub('published-slug-old', new Date('2026-01-01')),
          pub('published-slug-new', new Date('2026-02-01')),
        ],
      },
    ]);
    expect(got).toEqual([{ title: 'Post One', url: 'https://a.com/blog/published-slug-new' }]);
  });

  test('falls back to article.slug when there is no publication entry', () => {
    const got = deriveCandidates('https://a.com/blog', [
      { title: 'Post', slug: 'fallback', publications: [] },
    ]);
    expect(got[0]!.url).toBe('https://a.com/blog/fallback');
  });

  test('drops undecidable URLs and de-duplicates', () => {
    const got = deriveCandidates('', [{ title: 'P', slug: 's', publications: [] }]);
    expect(got).toEqual([]);

    const dupes = deriveCandidates('https://a.com/blog', [
      { title: 'A', slug: 'same', publications: [] },
      { title: 'B', slug: 'same', publications: [] },
    ]);
    expect(dupes).toHaveLength(1);
  });
});

describe('extractLinks', () => {
  test('returns inline links and ignores images', () => {
    const md = 'see [one](https://a.com/1) and ![alt](https://cdn.com/x.webp) and [two](#)';
    expect(extractLinks(md)).toEqual([
      { text: 'one', url: 'https://a.com/1' },
      { text: 'two', url: '#' },
    ]);
  });

  test('sees links titled with any CommonMark delimiter (#186)', () => {
    const md = `[a](/one "T") [b](/two 'T') [c](/three (T))`;
    expect(extractLinks(md)).toEqual([
      { text: 'a', url: '/one' },
      { text: 'b', url: '/two' },
      { text: 'c', url: '/three' },
    ]);
  });
});

describe('sanitizeLinks', () => {
  const allowed = ['https://a.com/blog/one', 'https://a.com/blog/two'];

  test('keeps an allowed link untouched', () => {
    const md = 'read [our guide](https://a.com/blog/one) now';
    expect(sanitizeLinks(md, allowed, 2)).toBe(md);
  });

  test('unwraps an unapproved link to its anchor text', () => {
    expect(sanitizeLinks('see [features](/features/invented) here', allowed, 2)).toBe(
      'see features here',
    );
    expect(sanitizeLinks('see [this](#) here', allowed, 2)).toBe('see this here');
    expect(sanitizeLinks('see [x](https://example.com) here', allowed, 2)).toBe('see x here');
  });

  test('unwraps allowed links beyond the ceiling, keeping the first ones', () => {
    const md = '[a](https://a.com/blog/one) then [b](https://a.com/blog/two)';
    expect(sanitizeLinks(md, allowed, 1)).toBe('[a](https://a.com/blog/one) then b');
  });

  test('unwraps a repeat of an already-used target', () => {
    const md = '[a](https://a.com/blog/one) and again [a](https://a.com/blog/one)';
    expect(sanitizeLinks(md, allowed, 3)).toBe('[a](https://a.com/blog/one) and again a');
  });

  test('a max of 0 removes every link', () => {
    expect(sanitizeLinks('[a](https://a.com/blog/one)', allowed, 0)).toBe('a');
  });

  test('never touches image syntax', () => {
    const md = '![cover](https://cdn.com/c.webp)\n\n[bad](/nope)';
    expect(sanitizeLinks(md, allowed, 2)).toBe('![cover](https://cdn.com/c.webp)\n\nbad');
  });

  test('matches allowed URLs regardless of a trailing slash', () => {
    expect(sanitizeLinks('[a](https://a.com/blog/one/)', allowed, 1)).toBe(
      '[a](https://a.com/blog/one)',
    );
  });

  test('re-emits the verified canonical URL, not the model variant (#186)', () => {
    // Verification proved the no-slash form live; a static host may 404 the other.
    expect(sanitizeLinks('read [our guide](https://a.com/blog/one/ ) now', allowed, 1)).toBe(
      'read [our guide](https://a.com/blog/one) now',
    );
    // Anchor text survives verbatim, punctuation and all.
    expect(sanitizeLinks('[**Our** guide, v2](https://a.com/blog/one/)', allowed, 1)).toBe(
      '[**Our** guide, v2](https://a.com/blog/one)',
    );
  });

  test('drops a title in any CommonMark delimiter on a kept link (#186)', () => {
    expect(sanitizeLinks('[a](https://a.com/blog/one "T")', allowed, 1)).toBe(
      '[a](https://a.com/blog/one)',
    );
    expect(sanitizeLinks("[a](https://a.com/blog/one 'T')", allowed, 1)).toBe(
      '[a](https://a.com/blog/one)',
    );
    expect(sanitizeLinks('[a](https://a.com/blog/one (T))', allowed, 1)).toBe(
      '[a](https://a.com/blog/one)',
    );
  });

  test('unwraps an unapproved link carrying a title in any delimiter (#186)', () => {
    expect(sanitizeLinks("see [our sizing guide](/guides/sizing 'Sizing Guide')", allowed, 2)).toBe(
      'see our sizing guide',
    );
    expect(sanitizeLinks('see [our sizing guide](/guides/sizing (Sizing))', allowed, 2)).toBe(
      'see our sizing guide',
    );
    expect(sanitizeLinks('see [our sizing guide](/guides/sizing "Sizing")', allowed, 2)).toBe(
      'see our sizing guide',
    );
  });

  test('a titled image is still never touched (#186)', () => {
    const md = "![cover](https://cdn.com/c.webp 'Cover')";
    expect(sanitizeLinks(md, allowed, 2)).toBe(md);
  });

  test('leaves ordinary prose parentheses alone (#186)', () => {
    const md = 'Widgets (the metal kind) cost more. See [a](https://a.com/blog/one) — 5 (five).';
    expect(sanitizeLinks(md, allowed, 2)).toBe(md);
  });
});

// A code SAMPLE of a link is not a link: rewriting one mangles the demo the
// article exists to show. Same reasoning as validate.ts's detector masking.
describe('code samples are not links', () => {
  const allowed = ['https://a.com/blog/one'];

  test('sanitizeLinks leaves a Markdown-link demo in a fenced block untouched', () => {
    const md = 'See [bad](/invented).\n\n```md\n[example](/some/url)\n```\n';
    expect(sanitizeLinks(md, allowed, 2)).toBe('See bad.\n\n```md\n[example](/some/url)\n```\n');
  });

  test('sanitizeLinks leaves a Markdown-link demo in an inline code span untouched', () => {
    const md = 'Write `[text](/url)` to make a link.';
    expect(sanitizeLinks(md, allowed, 2)).toBe(md);
  });

  test('a link whose anchor text contains a code span is still enforced', () => {
    expect(sanitizeLinks('see [the `config` guide](/invented) now', allowed, 2)).toBe(
      'see the `config` guide now',
    );
    const kept = 'see [the `config` guide](https://a.com/blog/one) now';
    expect(sanitizeLinks(kept, allowed, 2)).toBe(kept);
  });

  test('extractLinks ignores links inside fences and spans', () => {
    const md = '[real](/x)\n\n```\n[demo](/y)\n```\n\nUse `[demo](/z)` here.';
    expect(extractLinks(md)).toEqual([{ text: 'real', url: '/x' }]);
  });
});

// CommonMark permits balanced brackets in link text and balanced parens in the
// destination; the old regex handled neither, so a bracket-nested invented link
// shipped unchanged — the #186 incident shape — and a paren destination was
// prefix-matched, corrupting the prose. The scanner must close both.
describe('bracket-nested links', () => {
  const allowed = ['https://a.com/blog/one'];

  test('unwraps an invented link whose text contains balanced brackets', () => {
    expect(sanitizeLinks('see [the [beta] guide](/features/invented) now', allowed, 2)).toBe(
      'see the [beta] guide now',
    );
    expect(sanitizeLinks('[as noted in [1]](/features/invented)', allowed, 2)).toBe(
      'as noted in [1]',
    );
  });

  test('keeps an approved link whose text contains balanced brackets', () => {
    expect(sanitizeLinks('[the [beta] guide](https://a.com/blog/one)', allowed, 2)).toBe(
      '[the [beta] guide](https://a.com/blog/one)',
    );
  });

  test('a balanced-paren destination is consumed whole, not prefix-matched', () => {
    // The regex matched `[a](/x(y)` and left `z)` behind: corrupted prose.
    expect(sanitizeLinks('[a](/x(y)z)', allowed, 2)).toBe('a');
  });

  test('an angle-bracket destination is a link, not prose', () => {
    expect(sanitizeLinks('see [x](</docs y>) here', allowed, 2)).toBe('see x here');
    expect(sanitizeLinks('[x](<https://a.com/blog/one>)', allowed, 2)).toBe(
      '[x](https://a.com/blog/one)',
    );
  });

  test('an empty destination is a link to nowhere and is unwrapped', () => {
    expect(sanitizeLinks('[a]()', allowed, 2)).toBe('a');
  });

  test('unwrapping an inner link cannot expose a new unvetted outer link', () => {
    // CommonMark links cannot nest: the INNER one renders, the outer brackets
    // are literal. Unwrapping the inner leaves text that re-parses as the outer
    // link, so sanitization must iterate to a fixpoint.
    expect(
      sanitizeLinks('[outer [inner](/features/invented) rest](/also/invented)', allowed, 2),
    ).toBe('outer inner rest');
    expect(
      sanitizeLinks('[outer [inner](/features/invented) rest](https://a.com/blog/one)', allowed, 2),
    ).toBe('[outer inner rest](https://a.com/blog/one)');
  });

  test('a link wrapping an image is decided by its own target', () => {
    const kept = '[see ![alt](https://cdn.com/x.webp) now](https://a.com/blog/one)';
    expect(sanitizeLinks(kept, allowed, 2)).toBe(kept);
    expect(sanitizeLinks('[see ![alt](https://cdn.com/x.webp) now](/invented)', allowed, 2)).toBe(
      'see ![alt](https://cdn.com/x.webp) now',
    );
  });

  test('an invented link inside an image alt is unwrapped, the image kept', () => {
    expect(sanitizeLinks('![alt [x](/invented)](https://cdn.com/i.webp)', allowed, 2)).toBe(
      '![alt x](https://cdn.com/i.webp)',
    );
  });

  test('escaped brackets are literal text, not link structure', () => {
    const md = 'see \\[not a link\\](/x) here';
    expect(sanitizeLinks(md, allowed, 2)).toBe(md);
    expect(sanitizeLinks('[a \\[b\\] c](/features/invented)', allowed, 2)).toBe('a \\[b\\] c');
  });

  test('extractLinks agrees with the sanitizer on nested brackets', () => {
    expect(extractLinks('[see [1]](/x)')).toEqual([{ text: 'see [1]', url: '/x' }]);
  });

  test('does not trigger on brackets in ordinary prose, alt text, tables, or footnotes', () => {
    const cases = [
      'The [beta] build (see above) is out.',
      '![from [studio] shoot](https://cdn.com/x.webp)',
      '| col | note |\n| --- | --- |\n| [beta] | (soon) |',
      'as shown[^1] earlier.\n\n[^1]: The 2025 survey.',
      'a bracket pair [here] and parens (there) far apart',
    ];
    for (const md of cases) expect(sanitizeLinks(md, allowed, 2)).toBe(md);
  });

  test('a code sample of a bracket-nested link is untouched', () => {
    const md = '```md\n[the [beta] guide](/features/invented)\n```\n';
    expect(sanitizeLinks(md, allowed, 2)).toBe(md);
  });

  test('text spanning a blank line is not a link', () => {
    const md = '[a\n\nb](/features/invented)';
    expect(sanitizeLinks(md, allowed, 2)).toBe(md);
  });
});

const org = {
  id: 'o1',
  presets: {
    business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
    audience: { target: ['makers'], competitors: [] },
    blog: { sitemap_url: '', main_blog_url: 'https://a.com/blog', best_articles: [] },
    article_preferences: {
      content_seo: {
        article_style: 'practical',
        internal_links_count: 2,
        table_of_contents: true,
        llm_instructions: '',
      },
      engagement: { image_style: '', youtube_videos: true },
      publishing: { auto_publish: false },
    },
  },
} as unknown as Org;

const keyword = { keyword: 'best widgets' } as Keyword;

describe('buildContext link fields', () => {
  test('carries the raw preset count and the supplied candidates', () => {
    const ctx = buildContext(org, keyword, [{ title: 'One', url: 'https://a.com/blog/one' }]);
    expect(ctx.maxInternalLinks).toBe(2);
    expect(ctx.linkCandidates).toEqual([{ title: 'One', url: 'https://a.com/blog/one' }]);
  });

  test('defaults to no candidates when none are supplied', () => {
    expect(buildContext(org, keyword).linkCandidates).toEqual([]);
  });
});
