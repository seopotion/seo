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
 * CommonMark) still parses as a destination and fails closed instead of
 * slipping past.
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

/**
 * An inline link or image located by `scanInlineLinks`, as byte offsets into
 * the scanned string. `maskCode` is length-preserving, so offsets found on
 * masked content are valid on the original.
 */
interface InlineSpan {
  start: number; // the '!' for an image, else the '['
  end: number; // just past the closing ')'
  textStart: number;
  textEnd: number; // the matching ']'
  url: string;
  isImage: boolean;
}

/** Is the character at `pos` behind an odd run of backslashes? */
function isEscaped(s: string, pos: number): boolean {
  let backslashes = 0;
  for (let k = pos - 1; k >= 0 && s[k] === '\\'; k--) backslashes++;
  return backslashes % 2 === 1;
}

/** Skip spaces/tabs and at most one newline — a blank line ends inline
 * context. Returns the index after the whitespace, or -1 on a blank line. */
function skipInlineWhitespace(s: string, from: number): number {
  let newline = false;
  let i = from;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === ' ' || c === '\t') continue;
    if (c === '\n') {
      if (newline) return -1;
      newline = true;
      continue;
    }
    break;
  }
  return i;
}

/**
 * `(destination "title")` following a `]`, per CommonMark: an `<angle>`
 * destination (may contain spaces) or a bare one with BALANCED unescaped
 * parens, then an optional title in any of the three delimiters. Returns null
 * when it does not parse — the bracket pair was not an inline link. An empty
 * destination (`[a]()`) is legal and returns `url: ''`, which no allow-list
 * contains, so it unwraps.
 */
function parseDestination(s: string, open: number): { url: string; end: number } | null {
  if (s[open] !== '(') return null;
  let i = skipInlineWhitespace(s, open + 1);
  if (i < 0) return null;
  let url = '';
  if (s[i] === '<') {
    let j = i + 1;
    while (j < s.length && s[j] !== '>' && s[j] !== '<' && s[j] !== '\n')
      j += s[j] === '\\' ? 2 : 1;
    if (s[j] !== '>') return null;
    url = s.slice(i + 1, j);
    i = j + 1;
  } else {
    const start = i;
    let depth = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === ' ' || c === '\t' || c === '\n') break;
      if (c === '(') depth++;
      else if (c === ')') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    if (depth !== 0) return null;
    url = s.slice(start, Math.min(i, s.length));
  }
  let j = skipInlineWhitespace(s, i);
  if (j < 0) return null;
  if (j > i && (s[j] === '"' || s[j] === "'" || s[j] === '(')) {
    const paren = s[j] === '(';
    const closer = paren ? ')' : (s[j] as string);
    let m = j + 1;
    while (m < s.length && s[m] !== closer) {
      if (paren && s[m] === '(') return null; // a paren title cannot nest
      m += s[m] === '\\' ? 2 : 1;
    }
    if (m >= s.length) return null;
    j = skipInlineWhitespace(s, m + 1);
    if (j < 0) return null;
  }
  if (s[j] !== ')') return null;
  return { url, end: j + 1 };
}

/**
 * Every inline link and image in `s`, by walking brackets with a stack the way
 * CommonMark pairs them: `]` closes the NEAREST open `[`/`![`, so balanced
 * brackets in anchor text (`[the [beta] guide](/x)`) resolve correctly — the
 * old regex could not contain `]` in text at all, and a bracket-nested invented
 * link shipped unchanged, the exact #186 incident shape.
 *
 * Approximations, all resolved fail-closed by the sanitizer's fixpoint loop or
 * the `validate.ts` backstop (which uses this same scanner via `extractLinks`):
 *  - a completed outer span swallows spans completed inside it (an image keeps
 *    its bytes verbatim; alt text never renders as live HTML), and a completed
 *    LINK deactivates every earlier opener — CommonMark's no-links-in-links
 *    rule, which also means unwrapping an inner link can expose an outer one
 *    that only the next sanitize pass sees;
 *  - text containing a blank line is not a link (no CommonMark renderer links
 *    it either, so leaving it is renderer-aligned);
 *  - reference-style USES (`[text][ref]`) are still out of scope: their
 *    definition line is what `validate.ts` rejects, and a use without a
 *    definition renders as plain text.
 */
function scanInlineLinks(s: string): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const openers: { pos: number; isImage: boolean }[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '[') {
      const isImage = i > 0 && s[i - 1] === '!' && !isEscaped(s, i - 1);
      openers.push({ pos: isImage ? i - 1 : i, isImage });
      i++;
      continue;
    }
    if (c !== ']') {
      i++;
      continue;
    }
    const opener = openers.pop();
    i++;
    if (!opener) continue;
    const textStart = opener.pos + (opener.isImage ? 2 : 1);
    const textEnd = i - 1;
    if (/\n[ \t]*\n/.test(s.slice(textStart, textEnd))) continue;
    const dest = parseDestination(s, i);
    if (!dest) continue;
    while (spans.length && (spans.at(-1) as InlineSpan).start > opener.pos) spans.pop();
    spans.push({
      start: opener.pos,
      end: dest.end,
      textStart,
      textEnd,
      url: dest.url,
      isImage: opener.isImage,
    });
    if (!opener.isImage) openers.length = 0;
    i = dest.end;
  }
  return spans;
}

/** Every inline link in the Markdown, in document order. Images and code
 * samples excluded. Anchor text is read back from the original (a code span
 * inside it would otherwise surface as `maskCode` filler). */
export function extractLinks(md: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  for (const span of scanInlineLinks(maskCode(md))) {
    if (span.isImage) continue;
    links.push({ text: md.slice(span.textStart, span.textEnd), url: span.url });
  }
  return links;
}

/** Unwrapping `[inner](x)` inside `[outer [inner](x) rest](y)` leaves text
 * that re-parses as the outer link, so one pass is not enough. Each changed
 * pass removes at least one link, so this terminates well under the cap for
 * real content; anything a capped-out pathological input leaves behind is
 * caught by `validateArticle` and fails the article. */
const MAX_SANITIZE_PASSES = 10;

/**
 * Fail closed: unwrap every link that is not in `allowedUrls`, is a repeat of a
 * target already used, or falls beyond `max`. Unwrapping keeps the anchor text,
 * so the prose still reads — only the dead href goes away.
 *
 * A kept link is re-emitted against OUR canonical URL, not the model's variant:
 * verification proved the canonical form live, and on a static host the
 * trailing-slash variant it matched loosely may 404. Anchor text is verbatim.
 *
 * Spans come from `maskCode`d content — a code sample of a link is left
 * exactly as written — and are resolved back to the original by offset, which
 * `maskCode` preserves.
 */
export function sanitizeLinks(content: string, allowedUrls: string[], max: number): string {
  for (let pass = 0; pass < MAX_SANITIZE_PASSES; pass++) {
    const next = sanitizePass(content, allowedUrls, max);
    if (next === content) break;
    content = next;
  }
  return content;
}

function sanitizePass(content: string, allowedUrls: string[], max: number): string {
  const allowed = new Map(allowedUrls.map((u) => [normalizeUrl(u), u]));
  const used = new Set<string>();
  let out = '';
  let last = 0;
  for (const span of scanInlineLinks(maskCode(content))) {
    out += content.slice(last, span.start);
    last = span.end;
    if (span.isImage) {
      out += content.slice(span.start, span.end);
      continue;
    }
    const originalText = content.slice(span.textStart, span.textEnd);
    const key = normalizeUrl(span.url);
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
