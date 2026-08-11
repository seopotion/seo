import type { Article } from '@shared/schemas';

/**
 * Normalize a page URL for matching (#208): drop protocol, lowercase the host,
 * strip `www.`, query string (tracking params), fragment, and the trailing
 * slash. Path segment case is preserved — GSC reports canonical URLs.
 */
export function normalizeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return host + path;
}

/** Final path segment of a URL, decoded; null for the root or unparseable input. */
function finalSegment(url: string): string | null {
  const normalized = normalizeUrl(url);
  if (normalized === null) return null;
  const segments = normalized.split('/');
  if (segments.length < 2) return null;
  const last = segments[segments.length - 1] ?? '';
  if (last === '') return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return null;
  }
}

/**
 * Match a GSC page URL to one of our articles (#208): the normalized final
 * path segment must EXACTLY equal a `publications[].slug` — the slug the
 * article was actually published under (`article.slug` can be renamed in the
 * editor afterwards). Any publication counts (dual WordPress + static-site).
 */
export function matchArticleByPage<A extends Pick<Article, 'publications'>>(
  pageUrl: string,
  articles: A[],
): A | null {
  const segment = finalSegment(pageUrl);
  if (segment === null) return null;
  return articles.find((a) => a.publications.some((p) => p.slug === segment)) ?? null;
}
