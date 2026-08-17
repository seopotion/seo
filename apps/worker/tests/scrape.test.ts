import { afterEach, describe, expect, test, vi } from 'vitest';
import { discoverBlog, fetchSite } from '../src/scrape';

/** Route fetch by URL; unmatched URLs resolve to a 404-ish response. */
function stubFetch(routes: Record<string, string>, contentLengths: Record<string, number> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const key = String(input);
      const body = routes[key];
      const length = contentLengths[key];
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        headers: new Headers(length !== undefined ? { 'content-length': String(length) } : {}),
        text: async () => body ?? '',
      } as Response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchSite', () => {
  test('strips HTML to visible text', async () => {
    stubFetch({
      'https://clewas.com':
        '<html><head><style>x{}</style><script>bad()</script></head>' +
        '<body><h1>Clewas</h1><a href="/blog">Blog</a></body></html>',
    });

    const page = await fetchSite('https://clewas.com');

    expect(page?.text).toBe('Clewas Blog');
  });

  test('returns null when the fetch throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );

    expect(await fetchSite('https://clewas.com')).toBeNull();
  });

  test('returns null when the declared content-length exceeds the cap', async () => {
    stubFetch(
      { 'https://clewas.com': '<html><body>Hello</body></html>' },
      { 'https://clewas.com': 6_000_000 },
    );

    expect(await fetchSite('https://clewas.com')).toBeNull();
  });
});

describe('discoverBlog', () => {
  test('reads the sitemap from robots.txt and pulls blog articles', async () => {
    stubFetch({
      'https://clewas.com/robots.txt': 'User-agent: *\nSitemap: https://clewas.com/sitemap.xml',
      'https://clewas.com/sitemap.xml':
        '<urlset><url><loc>https://clewas.com/</loc></url>' +
        '<url><loc>https://clewas.com/blog/post-1</loc></url></urlset>',
    });

    const blog = await discoverBlog('https://clewas.com');

    expect(blog.sitemap_url).toBe('https://clewas.com/sitemap.xml');
    expect(blog.main_blog_url).toBe('https://clewas.com/blog');
    expect(blog.best_articles).toEqual(['https://clewas.com/blog/post-1']);
  });

  test('pagination pages are not best articles (#228)', async () => {
    // Clewas-shaped sitemap: /blog is the index, /blog/2 is pagination, and the
    // posts live at the root. Suggesting /blog/2 as a "best article" is worse
    // than suggesting nothing.
    stubFetch({
      'https://clewas.com/robots.txt': 'User-agent: *\nSitemap: https://clewas.com/sitemap.xml',
      'https://clewas.com/sitemap.xml':
        '<urlset><url><loc>https://clewas.com/blog</loc></url>' +
        '<url><loc>https://clewas.com/blog/2</loc></url>' +
        '<url><loc>https://clewas.com/blog/actual-post</loc></url>' +
        '<url><loc>https://clewas.com/what-is-osmosis</loc></url></urlset>',
    });

    const blog = await discoverBlog('https://clewas.com');

    expect(blog.best_articles).toEqual(['https://clewas.com/blog/actual-post']);
  });

  test('falls back to defaults when robots and sitemap are absent', async () => {
    stubFetch({});

    const blog = await discoverBlog('https://clewas.com');

    expect(blog.sitemap_url).toBe('https://clewas.com/sitemap.xml');
    expect(blog.main_blog_url).toBe('https://clewas.com/blog');
    expect(blog.best_articles).toEqual([]);
  });
});
