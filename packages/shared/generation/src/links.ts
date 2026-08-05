/**
 * Internal-link primitives (#186). Pure: no I/O, no db, no provider calls —
 * the networked half lives in `link-verify.ts`.
 *
 * The rule these enforce: an article may only link to a URL we have already
 * proven belongs to a published page of the same org. Anything else is
 * unwrapped to plain text rather than guessed at.
 */

/** A link target we are willing to hand to the model. */
export interface LinkCandidate {
  title: string;
  url: string;
}

export interface MarkdownLink {
  text: string;
  url: string;
}

/** The article fields `deriveCandidates` needs — a structural subset of `Article`
 * so this module does not depend on `@shared/schemas` or `@shared/db`. */
export interface PublishedArticleInput {
  title: string;
  slug: string;
  publications: { slug: string; published_at: Date }[];
}

/**
 * Inline Markdown links. Group 1 is the image marker, 2 the anchor text, 3 the
 * href. Reference-style links (`[a][b]`) are deliberately unmatched: the model
 * has never produced them, and an unmatched link is left alone, not approved —
 * `validate.ts` uses this same extractor, so both halves agree on what a link is.
 */
const LINK_RE = /(!?)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g;

/** Compare URLs without tripping over a trailing slash or stray whitespace. */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** The live URL of a published article, or null when we cannot decide it. */
export function publishedArticleUrl(mainBlogUrl: string, slug: string): string | null {
  const base = mainBlogUrl.trim();
  const path = slug.trim().replace(/^\/+|\/+$/g, '');
  if (!base || !path) return null;
  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return `${base.replace(/\/+$/, '')}/${path}`;
}

/**
 * Candidate targets for an org's published articles. The slug comes from the
 * most recent `publications` entry — the slug the article ACTUALLY went live
 * under, which the editor can change on `article.slug` afterwards.
 */
export function deriveCandidates(
  mainBlogUrl: string,
  articles: PublishedArticleInput[],
): LinkCandidate[] {
  const seen = new Set<string>();
  const candidates: LinkCandidate[] = [];
  for (const article of articles) {
    const latest = [...article.publications].sort(
      (a, b) => b.published_at.getTime() - a.published_at.getTime(),
    )[0];
    const url = publishedArticleUrl(mainBlogUrl, latest?.slug ?? article.slug);
    if (!url) continue;
    const key = normalizeUrl(url);
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ title: article.title, url });
  }
  return candidates;
}

/** Every inline link in the Markdown, in document order. Images excluded. */
export function extractLinks(md: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const match of md.matchAll(LINK_RE)) {
    if (match[1] === '!') continue;
    links.push({ text: match[2] ?? '', url: match[3] ?? '' });
  }
  return links;
}

/**
 * Fail closed: unwrap every link that is not in `allowedUrls`, is a repeat of a
 * target already used, or falls beyond `max`. Unwrapping keeps the anchor text,
 * so the prose still reads — only the dead href goes away.
 */
export function sanitizeLinks(content: string, allowedUrls: string[], max: number): string {
  const allowed = new Set(allowedUrls.map(normalizeUrl));
  const used = new Set<string>();
  return content.replace(LINK_RE, (match, marker: string, text: string, url: string) => {
    if (marker === '!') return match;
    const key = normalizeUrl(url);
    if (!allowed.has(key) || used.has(key) || used.size >= max) return text;
    used.add(key);
    return match;
  });
}
