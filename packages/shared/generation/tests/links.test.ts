import type { Keyword, Org } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { buildContext } from '../src/context';
import {
  deduplicateLinkCandidates,
  deriveCandidates,
  extractLinks,
  normalizeUrl,
  prioritizeLinkCandidates,
  sanitizeLinks,
  staticSitePostUrl,
} from '../src/links';

describe('normalizeUrl', () => {
  test('trims whitespace and trailing slashes', () => {
    expect(normalizeUrl(' https://a.com/blog/x/ ')).toBe('https://a.com/blog/x');
    expect(normalizeUrl('https://a.com/blog/x')).toBe('https://a.com/blog/x');
  });
});

describe('staticSitePostUrl', () => {
  test('joins base and slug with exactly one slash', () => {
    expect(staticSitePostUrl('https://a.com/', 'my-post')).toBe('https://a.com/my-post');
    expect(staticSitePostUrl('https://a.com/posts', '/my-post/')).toBe(
      'https://a.com/posts/my-post',
    );
  });

  test('returns null for an empty base, empty slug, or non-http base', () => {
    expect(staticSitePostUrl('', 'my-post')).toBeNull();
    expect(staticSitePostUrl('https://a.com', '')).toBeNull();
    expect(staticSitePostUrl('not a url', 'my-post')).toBeNull();
    expect(staticSitePostUrl('ftp://a.com', 'my-post')).toBeNull();
  });

  test('returns null when the base carries a query or fragment', () => {
    // Appending a slug to these yields `…?page=2/my-post` — not a page URL.
    expect(staticSitePostUrl('https://a.com?page=2', 'my-post')).toBeNull();
    expect(staticSitePostUrl('https://a.com#latest', 'my-post')).toBeNull();
  });
});

describe('deriveCandidates', () => {
  const sources = { staticSitePostBase: 'https://a.com' };
  const article = (
    title: string,
    publications: {
      provider: 'wordpress' | 'static-site';
      slug: string;
      published_at: Date;
      remote_url: string | null;
    }[],
  ) => ({ title, publications, topic_cluster_id: null, topic_role: null });
  const staticPub = (slug: string, published_at = new Date('2026-01-01')) => ({
    provider: 'static-site' as const,
    slug,
    published_at,
    // What static-site actually stores here — a commit URL, never a post URL.
    remote_url: 'https://github.com/o/r/commit/abc',
  });
  const wpPub = (remote_url: string | null, published_at = new Date('2026-01-01')) => ({
    provider: 'wordpress' as const,
    slug: 'wp-slug',
    published_at,
    remote_url,
  });

  test('static-site: joins the configured post base with the published slug', () => {
    const got = deriveCandidates(sources, [
      {
        title: 'Post One',
        publications: [staticPub('old-slug'), staticPub('new-slug', new Date('2026-02-01'))],
        topic_cluster_id: 'topic:widgets',
        topic_role: 'pillar',
      },
    ]);
    expect(got).toEqual([
      {
        title: 'Post One',
        url: 'https://a.com/new-slug',
        topic_cluster_id: 'topic:widgets',
        topic_role: 'pillar',
      },
    ]);
  });

  test('static-site: dropped when no post base is configured', () => {
    const got = deriveCandidates({ staticSitePostBase: null }, [
      article('P', [staticPub('my-post')]),
    ]);
    expect(got).toEqual([]);
  });

  test('wordpress: uses the stored permalink, never a joined base', () => {
    const got = deriveCandidates({ staticSitePostBase: null }, [
      article('WP', [wpPub('https://site.com/archives/my-post')]),
    ]);
    expect(got[0]!.url).toBe('https://site.com/archives/my-post');
  });

  test('wordpress: dropped when the permalink is missing or not http(s)', () => {
    expect(deriveCandidates(sources, [article('A', [wpPub(null)])])).toEqual([]);
    expect(deriveCandidates(sources, [article('B', [wpPub('not a url')])])).toEqual([]);
    expect(deriveCandidates(sources, [article('C', [wpPub('ftp://site.com/x')])])).toEqual([]);
  });

  test('the most recent publication decides the provider', () => {
    const got = deriveCandidates(sources, [
      article('Both', [
        staticPub('static-slug', new Date('2026-01-01')),
        wpPub('https://site.com/wp-post', new Date('2026-02-01')),
      ]),
    ]);
    expect(got[0]!.url).toBe('https://site.com/wp-post');
  });

  test('an article with no publication entry is dropped, not guessed', () => {
    expect(deriveCandidates(sources, [article('P', [])])).toEqual([]);
  });

  test('de-duplicates articles resolving to the same URL', () => {
    const dupes = deriveCandidates(sources, [
      article('A', [staticPub('same')]),
      article('B', [staticPub('same')]),
    ]);
    expect(dupes).toHaveLength(1);
  });
});

describe('topic-aware link priority', () => {
  const topic = {
    topic_cluster_id: 'topic:widgets',
    topic_cluster_label: 'Widgets',
    topic_role: 'support' as const,
    topic_content_focus: 'Widget sizing',
    topic_primary_keyword: 'widget sizing',
  };
  const candidate = (
    title: string,
    topic_cluster_id: string | null,
    topic_role: 'pillar' | 'support' | null,
    url = `https://a.com/blog/${title.toLowerCase().replaceAll(' ', '-')}`,
  ) => ({ title, url, topic_cluster_id, topic_role });

  test('support prefers its pillar, then other same-cluster pages, preserving tier order', () => {
    const input = [
      candidate('Same Support One', 'topic:widgets', 'support'),
      candidate('Other', 'topic:other', 'pillar'),
      candidate('Cluster Pillar', 'topic:widgets', 'pillar'),
      candidate('Same Support Two', 'topic:widgets', 'support'),
    ];

    expect(prioritizeLinkCandidates(topic, input).map((item) => item.title)).toEqual([
      'Cluster Pillar',
      'Same Support One',
      'Same Support Two',
      'Other',
    ]);
    expect(input.map((item) => item.title)).toEqual([
      'Same Support One',
      'Other',
      'Cluster Pillar',
      'Same Support Two',
    ]);
  });

  test('pillar prefers supports and canonical URL de-duplication keeps the ranked first row', () => {
    const pillarTopic = { ...topic, topic_role: 'pillar' as const };
    const input = [
      candidate('Cluster Pillar', 'topic:widgets', 'pillar', 'https://a.com/blog/shared/'),
      candidate('Other', 'topic:other', 'support'),
      candidate('Cluster Support', 'topic:widgets', 'support', 'https://a.com/blog/shared'),
    ];

    const ranked = prioritizeLinkCandidates(pillarTopic, input);
    expect(ranked.map((item) => item.title)).toEqual([
      'Cluster Support',
      'Cluster Pillar',
      'Other',
    ]);
    expect(deduplicateLinkCandidates(ranked).map((item) => item.title)).toEqual([
      'Cluster Support',
      'Other',
    ]);
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

const keyword = {
  keyword: 'best widgets',
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
} as Keyword;

describe('buildContext link fields', () => {
  test('carries the raw preset count and the supplied candidates', () => {
    const ctx = buildContext(org, keyword, [
      {
        title: 'One',
        url: 'https://a.com/blog/one',
        topic_cluster_id: null,
        topic_role: null,
      },
    ]);
    expect(ctx.maxInternalLinks).toBe(2);
    expect(ctx.linkCandidates).toEqual([
      {
        title: 'One',
        url: 'https://a.com/blog/one',
        topic_cluster_id: null,
        topic_role: null,
      },
    ]);
  });

  test('defaults to no candidates when none are supplied', () => {
    expect(buildContext(org, keyword).linkCandidates).toEqual([]);
  });

  test('copies all Keyword topic fields exactly', () => {
    const semantic = {
      ...keyword,
      topic_cluster_id: 'topic:best widgets',
      topic_cluster_label: 'Widget selection',
      topic_role: 'support' as const,
      topic_content_focus: 'How makers choose the right widget',
      topic_primary_keyword: ' Best   Widgets ',
    } as Keyword;

    expect(buildContext(org, semantic)).toMatchObject({
      topic_cluster_id: 'topic:best widgets',
      topic_cluster_label: 'Widget selection',
      topic_role: 'support',
      topic_content_focus: 'How makers choose the right widget',
      topic_primary_keyword: ' Best   Widgets ',
    });
  });
});
