import { afterEach, describe, expect, test, vi } from 'vitest';
import { discoverBlog, fetchSite } from '../src/scrape';

/** Route fetch by URL; unmatched URLs resolve to a 404-ish response. */
function stubFetch(routes: Record<string, string>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const body = routes[String(input)];
      return {
        ok: body !== undefined,
        status: body !== undefined ? 200 : 404,
        text: async () => body ?? '',
      } as Response;
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchSite', () => {
  test('strips HTML to visible text and extracts absolute links', async () => {
    stubFetch({
      'https://clewas.com':
        '<html><head><style>x{}</style><script>bad()</script></head>' +
        '<body><h1>Clewas</h1><a href="/blog">Blog</a></body></html>',
    });

    const page = await fetchSite('https://clewas.com');

    expect(page?.text).toBe('Clewas Blog');
    expect(page?.links).toContain('https://clewas.com/blog');
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

  test('falls back to defaults when robots and sitemap are absent', async () => {
    stubFetch({});

    const blog = await discoverBlog('https://clewas.com');

    expect(blog.sitemap_url).toBe('https://clewas.com/sitemap.xml');
    expect(blog.main_blog_url).toBe('https://clewas.com/blog');
    expect(blog.best_articles).toEqual([]);
  });
});
