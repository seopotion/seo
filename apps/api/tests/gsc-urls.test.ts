import { describe, expect, test } from 'vitest';
import { finalSegment, matchArticleByPage, normalizeUrl } from '../src/lib/gsc-urls';

/** Minimal article shape: the matcher only reads `publications[].slug`. */
function article(id: string, ...slugs: string[]) {
  return {
    id,
    publications: slugs.map((slug) => ({
      provider: 'static-site' as const,
      ref: 'sha',
      slug,
      published_at: new Date('2026-07-01T00:00:00Z'),
      updated_at: null,
      remote_url: null,
    })),
  };
}

describe('normalizeUrl', () => {
  test('lowercases the host and strips www., query, fragment, trailing slash', () => {
    expect(normalizeUrl('HTTPS://WWW.Example.COM/Blog/My-Post/?utm_source=x#top')).toBe(
      'example.com/Blog/My-Post',
    );
  });

  test('http and https normalize identically', () => {
    expect(normalizeUrl('http://example.com/a')).toBe(normalizeUrl('https://example.com/a'));
  });

  test('root URL keeps no trailing slash artifacts', () => {
    expect(normalizeUrl('https://example.com/')).toBe('example.com/');
  });

  test('unparseable input returns null', () => {
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('finalSegment', () => {
  test('root URL returns null', () => {
    expect(finalSegment('https://example.com/')).toBeNull();
    expect(finalSegment('https://example.com')).toBeNull();
  });

  test('nested path returns the decoded last segment', () => {
    expect(finalSegment('https://example.com/blog/nested/my-post')).toBe('my-post');
    expect(finalSegment('https://example.com/my%20post')).toBe('my post');
  });

  test('unparseable input returns null', () => {
    expect(finalSegment('not a url')).toBeNull();
  });
});

describe('matchArticleByPage', () => {
  test('matches the final path segment against a publication slug', () => {
    const a = article('a1', 'my-post');
    expect(matchArticleByPage('https://example.com/blog/my-post', [a])).toBe(a);
  });

  test('matches through www., http, trailing slash, and utm params', () => {
    const a = article('a1', 'my-post');
    for (const url of [
      'http://www.example.com/blog/my-post/',
      'https://example.com/my-post?utm_source=news&utm_medium=email',
      'https://WWW.EXAMPLE.COM/nested/deeper/my-post/',
    ]) {
      expect(matchArticleByPage(url, [a])).toBe(a);
    }
  });

  test('exact segment match — a slug that is a substring of another does not match', () => {
    const short = article('a1', 'seo');
    const long = article('a2', 'seo-tools');
    expect(matchArticleByPage('https://example.com/blog/seo-tools', [short, long])).toBe(long);
    expect(matchArticleByPage('https://example.com/blog/seo', [short, long])).toBe(short);
  });

  test('matches on ANY publication of a dual-published article', () => {
    const dual = article('a1', 'wp-slug', 'static-slug');
    expect(matchArticleByPage('https://example.com/static-slug', [dual])).toBe(dual);
    expect(matchArticleByPage('https://example.com/wp-slug', [dual])).toBe(dual);
  });

  test('publication slug, not the (renamed) article slug, is what matches', () => {
    const renamed = { ...article('a1', 'published-slug'), slug: 'renamed-slug' };
    expect(matchArticleByPage('https://example.com/published-slug', [renamed])).toBe(renamed);
    expect(matchArticleByPage('https://example.com/renamed-slug', [renamed])).toBeNull();
  });

  test('site root and unparseable URLs match nothing', () => {
    const a = article('a1', 'my-post');
    expect(matchArticleByPage('https://example.com/', [a])).toBeNull();
    expect(matchArticleByPage('not a url', [a])).toBeNull();
  });

  test('article with no publications never matches', () => {
    expect(matchArticleByPage('https://example.com/my-post', [article('a1')])).toBeNull();
  });
});
