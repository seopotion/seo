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
 * Inline Markdown links — the ONLY form this module sanitizes. Group 1 is the
 * image marker, 2 the anchor text, 3 the href; the optional CommonMark title is
 * matched in all three legal delimiters ("double", 'single', (parenthesised))
 * and dropped. `extractLinks` and `sanitizeLinks` share it, so both halves of
 * the enforcement agree on what a link is.
 *
 * What is NOT matched here is not unwrapped, and "not unwrapped" means it SHIPS
 * — this regex fails OPEN, so coverage matters:
 *  - sanitized (unwrapped, anchor text kept) here: inline links, per the above.
 *  - detected only (whole article fails validation, never rewritten), in
 *    `validate.ts`: raw HTML anchors `<a …>`, autolinks `<https://…>`, and
 *    reference-link definitions `[ref]: /path`.
 *  - unchecked by either: everything else, notably reference-style USES
 *    (`[text][ref]`) and links whose href contains a `)`. The model has never
 *    produced these, but nothing stops them if it does.
 */
const LINK_RE = /(!?)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

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
 *
 * A kept link is re-emitted against OUR canonical URL, not the model's variant:
 * verification proved the canonical form live, and on a static host the
 * trailing-slash variant it matched loosely may 404. Anchor text is verbatim.
 */
export function sanitizeLinks(content: string, allowedUrls: string[], max: number): string {
  const allowed = new Map(allowedUrls.map((u) => [normalizeUrl(u), u]));
  const used = new Set<string>();
  return content.replace(LINK_RE, (match, marker: string, text: string, url: string) => {
    if (marker === '!') return match;
    const key = normalizeUrl(url);
    const canonical = allowed.get(key);
    if (!canonical || used.has(key) || used.size >= max) return text;
    used.add(key);
    return `[${text}](${canonical})`;
  });
}
