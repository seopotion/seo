import { normalizeKeyword } from '@shared/schemas';
import {
  META_DESCRIPTION_MAX,
  META_DESCRIPTION_MIN,
  META_TITLE_MAX,
  MIN_H2,
  WORD_COUNT_FLOOR,
} from './config';
import { extractLinks, maskCode, maskIndentedCode, normalizeUrl } from './links';
import type { GenerationContext, ValidationFailure } from './types';

export function countWords(md: string): number {
  return md
    .replace(/[#>*_`~-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

/** Text before the first H2 (the introduction). */
function introText(lines: string[]): string {
  const firstH2 = lines.findIndex((l) => /^##\s+/.test(l));
  const body = (firstH2 === -1 ? lines : lines.slice(0, firstH2)).filter((l) => !/^#\s+/.test(l));
  return body.join('\n').trim();
}

/** Body text of each H2 section (excludes the heading line). */
function sectionBodies(lines: string[]): string[] {
  const bodies: string[] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (current) bodies.push(current.join('\n').trim());
      current = [];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) bodies.push(current.join('\n').trim());
  return bodies;
}

/**
 * Deterministic article checks. `allowedUrls` is the link set the backstop
 * validates against and MUST be the same set the sanitizer enforced — pass
 * `outline.internal_links`, not every candidate, or the backstop is wider than
 * what it backs (#186). Defaults to every candidate for callers with no outline.
 */
export function validateArticle(
  article: { title: string; meta_title: string; meta_description: string; content: string },
  ctx: GenerationContext,
  allowedUrls: string[] = ctx.linkCandidates.map((c) => c.url),
): ValidationFailure[] {
  const failures: ValidationFailure[] = [];
  const lines = article.content.split('\n');
  const h1Count = lines.filter((l) => /^#\s+/.test(l)).length;
  const h2Count = lines.filter((l) => /^##\s+/.test(l)).length;

  if (countWords(article.content) < WORD_COUNT_FLOOR)
    failures.push({ code: 'word_count', message: `below ${WORD_COUNT_FLOOR} words` });
  if (normalizeKeyword(article.title) === normalizeKeyword(ctx.keyword))
    failures.push({ code: 'title_equals_keyword', message: 'title is identical to the keyword' });
  if (article.meta_title.length > META_TITLE_MAX)
    failures.push({ code: 'meta_title_length', message: `meta_title > ${META_TITLE_MAX} chars` });
  if (
    article.meta_description.length < META_DESCRIPTION_MIN ||
    article.meta_description.length > META_DESCRIPTION_MAX
  )
    failures.push({
      code: 'meta_description_length',
      message: `meta_description not ${META_DESCRIPTION_MIN}-${META_DESCRIPTION_MAX} chars`,
    });
  if (h1Count !== 1)
    failures.push({ code: 'h1_count', message: `expected 1 H1, found ${h1Count}` });
  if (h2Count < MIN_H2)
    failures.push({ code: 'h2_count', message: `fewer than ${MIN_H2} H2 sections` });
  if (introText(lines).length === 0)
    failures.push({ code: 'empty_intro', message: 'missing introduction' });

  const bodies = sectionBodies(lines);
  if (bodies.some((b) => b.length === 0))
    failures.push({ code: 'empty_section', message: 'a section has an empty body' });
  if (new Set(bodies).size !== bodies.length)
    failures.push({ code: 'duplicate_section', message: 'two sections share identical bodies' });

  // Backstop for the sanitizer (#186). Reaching either branch means a link
  // survived sanitizeLinks, so the article must not ship.
  const approved = new Set(allowedUrls.map(normalizeUrl));
  const links = extractLinks(article.content);
  if (links.some((l) => !approved.has(normalizeUrl(l.url))))
    failures.push({
      code: 'illegal_link',
      message: 'link target is not an approved internal link',
    });
  else if (links.length > ctx.maxInternalLinks)
    failures.push({
      code: 'illegal_link',
      message: `more than ${ctx.maxInternalLinks} internal links`,
    });

  // Link forms `sanitizeLinks` cannot see, so they are detected here and fail
  // the article outright — never rewritten. Blunt on purpose: no prompt asks for
  // any of them, and this runs BEFORE the worker injects the YouTube <iframe>
  // and before the images worker injects `![...](...)`. Code samples — fenced,
  // inline, and indented — are excluded so an article ABOUT links does not fail
  // for demonstrating one. Indented blocks are masked ONLY here, not in the
  // sanitizer/extractor — see `maskIndentedCode` for why.
  const prose = maskIndentedCode(maskCode(article.content));
  if (/<a\s/i.test(prose))
    failures.push({ code: 'illegal_link', message: 'raw HTML anchor tag is not an allowed link' });
  if (/<https?:\/\/[^>\s]+>/.test(prose))
    failures.push({ code: 'illegal_link', message: 'autolink is not an allowed link' });
  // `[^\]^]` first char skips GFM footnotes (`[^1]: …`), which article.ts asks
  // for; requiring a link-shaped value skips glossary and timestamp prose.
  if (/^\s{0,3}\[[^\]^][^\]]*\]:\s*(?:<\S+>|https?:\/\/\S+|\/\S*)/m.test(prose))
    failures.push({
      code: 'illegal_link',
      message: 'reference-link definition is not an allowed link',
    });

  return failures;
}
