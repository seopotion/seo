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
 *
 * Matching runs against `maskCode`d content, so a code SAMPLE of a link — in a
 * fenced block or an inline span — is neither counted nor rewritten.
 */
const LINK_RE = /(!?)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;

// Lookarounds keep the run BOUNDED on both sides: without them `\1` matches a
// prefix of a longer run, so `` A ` <a href="x">y</a> `` B `` looked like a
// span, got blanked, and shipped a live link — fail-open, the #186 bug.
const SPAN_RE = /(?<!`)(`+)[^`\n]*\1(?!`)/g;

/**
 * `md` with code overwritten by same-LENGTH filler, so every offset outside
 * code is unchanged and a match on the masked text can be resolved against the
 * original. Fenced-block lines become spaces (a fence closes only on the same
 * character, at least as long, alone on its line — an unclosed fence blanks to
 * the end). Inline spans become NULs: a NUL is neither `)` nor whitespace, so a
 * span nested inside a link DESTINATION (`[a](/x\`y\`z)` — a live link to
 * CommonMark) still matches LINK_RE and fails closed instead of slipping past.
 */
export function maskCode(md: string): string {
  let fence: string | null = null;
  const lines = md.split('\n').map((line) => {
    const m = FENCE_RE.exec(line);
    if (fence === null) {
      if (!m) return line;
      fence = m[1] as string;
    } else if (m?.[1] && m[1][0] === fence[0] && m[1].length >= fence.length && !m[2]?.trim()) {
      fence = null;
    }
    return ' '.repeat(line.length);
  });
  return lines.join('\n').replace(SPAN_RE, (span) => '\0'.repeat(span.length));
}

/**
 * Additionally blank indented code blocks (4+ spaces or a tab, opened at a
 * blank line). ONLY the raw-link detectors in `validate.ts` use this: without
 * list context a 4-space line inside a loose list is ambiguous (paragraph
 * continuation vs code), and masking it for the SANITIZER could ship a live
 * invented link — while a detector false positive burns the whole article, the
 * worse error there. List-item lines stay visible as the common unambiguous case.
 */
export function maskIndentedCode(md: string): string {
  let prevBlank = true;
  let inBlock = false;
  const lines = md.split('\n').map((line) => {
    if (!line.trim()) {
      prevBlank = true;
      return line;
    }
    const opensHere = prevBlank || inBlock;
    prevBlank = false;
    if (opensHere && /^(?: {4,}|\t)/.test(line) && !/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) {
      inBlock = true;
      return ' '.repeat(line.length);
    }
    inBlock = false;
    return line;
  });
  return lines.join('\n');
}

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
  // A query or fragment can't have a slug appended (`…?page=2/my-post`).
  if (parsed.search || parsed.hash) return null;
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

/** Every inline link in the Markdown, in document order. Images and code
 * samples excluded. Anchor text is read back from the original (a span inside
 * it would otherwise surface as `maskCode` filler). */
export function extractLinks(md: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const match of maskCode(md).matchAll(LINK_RE)) {
    const [, marker = '', text = '', url = ''] = match;
    if (marker === '!') continue;
    const textStart = match.index + marker.length + 1;
    links.push({ text: md.slice(textStart, textStart + text.length), url });
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
 *
 * Matches come from `maskCode`d content — a code sample of a link is left
 * exactly as written — and are resolved back to the original by offset, which
 * `maskCode` preserves.
 */
export function sanitizeLinks(content: string, allowedUrls: string[], max: number): string {
  const allowed = new Map(allowedUrls.map((u) => [normalizeUrl(u), u]));
  const used = new Set<string>();
  let out = '';
  let last = 0;
  for (const match of maskCode(content).matchAll(LINK_RE)) {
    const [full, marker = '', text = '', url = ''] = match;
    out += content.slice(last, match.index);
    last = match.index + full.length;
    if (marker === '!') {
      out += content.slice(match.index, last);
      continue;
    }
    const textStart = match.index + marker.length + 1;
    const originalText = content.slice(textStart, textStart + text.length);
    const key = normalizeUrl(url);
    const canonical = allowed.get(key);
    if (!canonical || used.has(key) || used.size >= max) {
      out += originalText;
    } else {
      used.add(key);
      out += `[${originalText}](${canonical})`;
    }
  }
  return out + content.slice(last);
}
