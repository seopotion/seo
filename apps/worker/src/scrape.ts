const FETCH_TIMEOUT_MS = 10_000;
const SCRAPE_CHAR_BUDGET = 8_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; SeoPotionScanner/1.0; +https://seopotion.co/bot)';
const MAX_BEST_ARTICLES = 5;
const MAX_SITEMAP_URLS = 200;
const MAX_RESPONSE_BYTES = 5_000_000; // 5 MB cap on fetched homepage/sitemap bodies

export interface ScrapedPage {
  text: string;
}

export interface BlogInfo {
  sitemap_url: string;
  main_blog_url: string;
  best_articles: string[];
}

/** Fetch a URL as text with a timeout + UA header. Returns null on any failure. */
async function fetchText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const declaredLength = Number(res.headers.get('content-length'));
    if (declaredLength > MAX_RESPONSE_BYTES) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Strip a raw HTML document to visible text (script/style removed, tags dropped). */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SCRAPE_CHAR_BUDGET);
}

/** Fetch + parse a website homepage. Returns null if the page can't be fetched. */
export async function fetchSite(url: string): Promise<ScrapedPage | null> {
  const html = await fetchText(url);
  if (html === null) return null;
  return { text: htmlToText(html) };
}

/** Sitemap URLs declared in robots.txt (`Sitemap:` lines). */
async function sitemapsFromRobots(origin: string): Promise<string[]> {
  const txt = await fetchText(`${origin}/robots.txt`);
  if (!txt) return [];
  return [...txt.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]!);
}

/** Parse `<loc>` URLs out of a sitemap or sitemap-index document. */
function locsFrom(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!);
}

/**
 * Discover real blog URLs from robots.txt -> sitemap. Falls back to
 * `${origin}/sitemap.xml`, `${origin}/blog`, and no articles when nothing is found.
 */
export async function discoverBlog(url: string): Promise<BlogInfo> {
  const origin = new URL(url).origin;
  const declared = await sitemapsFromRobots(origin);
  const sitemapUrl = declared[0] ?? `${origin}/sitemap.xml`;

  const sitemapXml = await fetchText(sitemapUrl);
  let locs = sitemapXml ? locsFrom(sitemapXml) : [];

  // A sitemap index lists child sitemaps (.xml). Follow the first one, one level deep.
  if (locs.length && locs.every((l) => l.toLowerCase().endsWith('.xml'))) {
    const childXml = await fetchText(locs[0]!);
    locs = childXml ? locsFrom(childXml) : [];
  }
  locs = locs.slice(0, MAX_SITEMAP_URLS);

  const blogArticles = locs.filter((l) => /\/blog\/.+/i.test(l));
  return {
    sitemap_url: sitemapUrl,
    main_blog_url: `${origin}/blog`,
    best_articles: blogArticles.slice(0, MAX_BEST_ARTICLES),
  };
}
