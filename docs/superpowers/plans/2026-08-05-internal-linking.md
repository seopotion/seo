# Internal Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated articles link only to the org's own published pages, proven live by an HTTP check, with a hard ceiling — and never to invented URLs ([#186](https://github.com/seopotion/seo/issues/186)).

**Architecture:** Before generation, the worker lists the org's published articles, derives each URL from `presets.blog.main_blog_url` + the actually-published slug, and HTTP-verifies it; survivors become `ctx.linkCandidates`. The outline LLM picks at most `ctx.maxInternalLinks` of them (or none); the article prompt receives only those exact URLs. After humanize, a pure sanitizer unwraps any link that is not in the approved set or is over the ceiling, and `validate.ts` asserts the invariant as a backstop. A one-off CLI command applies the same sanitizer to existing articles.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, Hono/AWS Lambda (worker), citty (CLI), MongoDB 7, Biome.

## Global Constraints

- Every new/changed file must pass `npm run lint` (Biome: single quotes, 2-space indent, 100-char width, auto-organized imports). Run `npm run lint:fix` to format.
- `verbatimModuleSyntax` is on: type-only imports MUST use `import type`, type re-exports MUST use `export type`.
- Zod 4 + `@hono/zod-openapi` 1. Shared packages export TS source; no build step.
- Tests are Vitest; `vi.mock` is auto-hoisted above imports, `vi.hoisted` for spies you assert on.
- Before claiming any task done: `npm run lint`, `npm run check:all`, `npm test` must all pass.
- Commit message style matches the repo: `[area] Sentence in imperative mood`, e.g. `[generation] Add link sanitizer`. Areas used here: `generation`, `worker`, `cli`, `docs`.
- Branch is `claude/issue-186-0ce2e5`; PRs target `dev`. Never commit directly to `dev`/`master`.
- Reference the issue in commits where natural (`Part of #186`); the PR body carries `Closes #186`.
- Design spec this plan implements: [`docs/superpowers/specs/2026-08-05-internal-linking-design.md`](../specs/2026-08-05-internal-linking-design.md).

---

## File Structure

**Create:**
- `packages/shared/generation/src/links.ts` — pure link primitives: types, URL normalization, URL derivation, Markdown link extraction, the sanitizer. No I/O.
- `packages/shared/generation/src/link-verify.ts` — `verifyCandidates()`, the only networked piece. Separate file so `links.ts` stays trivially testable.
- `packages/shared/generation/tests/links.test.ts`
- `packages/shared/generation/tests/link-verify.test.ts`
- `apps/cli/src/lib/links.ts` — the one-off cleanup, returning the CLI `Result` contract.
- `apps/cli/tests/links.test.ts`

**Modify:**
- `packages/shared/generation/src/types.ts` — `GenerationContext` link fields; `Outline.internal_links`.
- `packages/shared/generation/src/config.ts` — `MAX_LINK_CANDIDATES`.
- `packages/shared/generation/src/context.ts` — `buildContext` gains candidates.
- `packages/shared/generation/src/outline.ts` — schema, prompt, candidate-filtered parse.
- `packages/shared/generation/src/article.ts` — prompt receives resolved URLs.
- `packages/shared/generation/src/generate.ts` — sanitize between humanize and validate.
- `packages/shared/generation/src/validate.ts` — `illegal_link` backstop.
- `packages/shared/generation/src/index.ts` — exports.
- `packages/shared/db/src/repositories/article.repo.ts` — `replaceContent`.
- `apps/worker/src/generation.ts` — build candidates, pass to `buildContext`.
- `apps/cli/src/types.ts` — `CleanLinksData`.
- `apps/cli/src/commands/db.ts` — `clean-links` subcommand.
- Existing test fixtures that construct a `GenerationContext`: `packages/shared/generation/tests/{outline,prompts,generate,validate}.test.ts`.
- `PROGRESS.md`.

---

### Task 1: Pure link primitives

**Files:**
- Create: `packages/shared/generation/src/links.ts`
- Create: `packages/shared/generation/tests/links.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `interface LinkCandidate { title: string; url: string }`
  - `interface MarkdownLink { text: string; url: string }`
  - `interface PublishedArticleInput { title: string; slug: string; publications: { slug: string; published_at: Date }[] }`
  - `normalizeUrl(url: string): string`
  - `publishedArticleUrl(mainBlogUrl: string, slug: string): string | null`
  - `deriveCandidates(mainBlogUrl: string, articles: PublishedArticleInput[]): LinkCandidate[]`
  - `extractLinks(md: string): MarkdownLink[]`
  - `sanitizeLinks(content: string, allowedUrls: string[], max: number): string`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/generation/tests/links.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  deriveCandidates,
  extractLinks,
  normalizeUrl,
  publishedArticleUrl,
  sanitizeLinks,
} from '../src/links';

describe('normalizeUrl', () => {
  test('trims whitespace and trailing slashes', () => {
    expect(normalizeUrl(' https://a.com/blog/x/ ')).toBe('https://a.com/blog/x');
    expect(normalizeUrl('https://a.com/blog/x')).toBe('https://a.com/blog/x');
  });
});

describe('publishedArticleUrl', () => {
  test('joins base and slug with exactly one slash', () => {
    expect(publishedArticleUrl('https://a.com/blog/', 'my-post')).toBe('https://a.com/blog/my-post');
    expect(publishedArticleUrl('https://a.com/blog', '/my-post/')).toBe(
      'https://a.com/blog/my-post',
    );
  });

  test('returns null for an empty base, empty slug, or non-http base', () => {
    expect(publishedArticleUrl('', 'my-post')).toBeNull();
    expect(publishedArticleUrl('https://a.com/blog', '')).toBeNull();
    expect(publishedArticleUrl('not a url', 'my-post')).toBeNull();
    expect(publishedArticleUrl('ftp://a.com', 'my-post')).toBeNull();
  });
});

describe('deriveCandidates', () => {
  const pub = (slug: string, published_at: Date) => ({ slug, published_at });

  test('uses the most recent publication slug, not article.slug', () => {
    const got = deriveCandidates('https://a.com/blog', [
      {
        title: 'Post One',
        slug: 'edited-after-publish',
        publications: [
          pub('published-slug-old', new Date('2026-01-01')),
          pub('published-slug-new', new Date('2026-02-01')),
        ],
      },
    ]);
    expect(got).toEqual([{ title: 'Post One', url: 'https://a.com/blog/published-slug-new' }]);
  });

  test('falls back to article.slug when there is no publication entry', () => {
    const got = deriveCandidates('https://a.com/blog', [
      { title: 'Post', slug: 'fallback', publications: [] },
    ]);
    expect(got[0]!.url).toBe('https://a.com/blog/fallback');
  });

  test('drops undecidable URLs and de-duplicates', () => {
    const got = deriveCandidates('', [{ title: 'P', slug: 's', publications: [] }]);
    expect(got).toEqual([]);

    const dupes = deriveCandidates('https://a.com/blog', [
      { title: 'A', slug: 'same', publications: [] },
      { title: 'B', slug: 'same', publications: [] },
    ]);
    expect(dupes).toHaveLength(1);
  });
});

describe('extractLinks', () => {
  test('returns inline links and ignores images', () => {
    const md = 'see [one](https://a.com/1) and ![alt](https://cdn.com/x.webp) and [two](#)';
    expect(extractLinks(md)).toEqual([
      { text: 'one', url: 'https://a.com/1' },
      { text: 'two', url: '#' },
    ]);
  });
});

describe('sanitizeLinks', () => {
  const allowed = ['https://a.com/blog/one', 'https://a.com/blog/two'];

  test('keeps an allowed link untouched', () => {
    const md = 'read [our guide](https://a.com/blog/one) now';
    expect(sanitizeLinks(md, allowed, 2)).toBe(md);
  });

  test('unwraps an unapproved link to its anchor text', () => {
    expect(sanitizeLinks('see [features](/features/invented) here', allowed, 2)).toBe(
      'see features here',
    );
    expect(sanitizeLinks('see [this](#) here', allowed, 2)).toBe('see this here');
    expect(sanitizeLinks('see [x](https://example.com) here', allowed, 2)).toBe('see x here');
  });

  test('unwraps allowed links beyond the ceiling, keeping the first ones', () => {
    const md = '[a](https://a.com/blog/one) then [b](https://a.com/blog/two)';
    expect(sanitizeLinks(md, allowed, 1)).toBe('[a](https://a.com/blog/one) then b');
  });

  test('unwraps a repeat of an already-used target', () => {
    const md = '[a](https://a.com/blog/one) and again [a](https://a.com/blog/one)';
    expect(sanitizeLinks(md, allowed, 3)).toBe('[a](https://a.com/blog/one) and again a');
  });

  test('a max of 0 removes every link', () => {
    expect(sanitizeLinks('[a](https://a.com/blog/one)', allowed, 0)).toBe('a');
  });

  test('never touches image syntax', () => {
    const md = '![cover](https://cdn.com/c.webp)\n\n[bad](/nope)';
    expect(sanitizeLinks(md, allowed, 2)).toBe('![cover](https://cdn.com/c.webp)\n\nbad');
  });

  test('matches allowed URLs regardless of a trailing slash', () => {
    const md = '[a](https://a.com/blog/one/)';
    expect(sanitizeLinks(md, allowed, 1)).toBe(md);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- links`
Expected: FAIL — `Failed to resolve import "../src/links"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/generation/src/links.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- links`
Expected: PASS (all `links.test.ts` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/generation/src/links.ts packages/shared/generation/tests/links.test.ts && git commit -m "[generation] Add pure internal-link primitives

Part of #186"
```

---

### Task 2: HTTP verification of candidates

**Files:**
- Create: `packages/shared/generation/src/link-verify.ts`
- Create: `packages/shared/generation/tests/link-verify.test.ts`

**Interfaces:**
- Consumes: `LinkCandidate` from `./links` (Task 1).
- Produces: `verifyCandidates(candidates: LinkCandidate[]): Promise<LinkCandidate[]>` — returns only candidates whose URL answered 2xx.

- [ ] **Step 1: Write the failing test**

Create `packages/shared/generation/tests/link-verify.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { verifyCandidates } from '../src/link-verify';

const candidate = (n: number) => ({ title: `P${n}`, url: `https://a.com/blog/p${n}` });

afterEach(() => vi.unstubAllGlobals());

/** Stub global fetch with a per-URL status lookup. */
function stubFetch(statusByUrl: Record<string, number>, onCall?: (url: string, init: RequestInit) => void) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    onCall?.(url, init);
    const status = statusByUrl[url] ?? 404;
    return { ok: status >= 200 && status < 300, status } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('verifyCandidates', () => {
  test('keeps 2xx URLs and drops the rest', async () => {
    stubFetch({ 'https://a.com/blog/p1': 200, 'https://a.com/blog/p2': 404 });
    const live = await verifyCandidates([candidate(1), candidate(2)]);
    expect(live).toEqual([candidate(1)]);
  });

  test('retries with GET when HEAD is not allowed', async () => {
    const methods: string[] = [];
    let head = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        methods.push(init.method as string);
        if (head) {
          head = false;
          return { ok: false, status: 405 } as Response;
        }
        return { ok: true, status: 200 } as Response;
      }),
    );
    expect(await verifyCandidates([candidate(1)])).toEqual([candidate(1)]);
    expect(methods).toEqual(['HEAD', 'GET']);
  });

  test('a thrown request (timeout, DNS failure) drops the candidate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }),
    );
    expect(await verifyCandidates([candidate(1)])).toEqual([]);
  });

  test('an empty input makes no requests', async () => {
    const fetchMock = stubFetch({});
    expect(await verifyCandidates([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- link-verify`
Expected: FAIL — `Failed to resolve import "../src/link-verify"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/generation/src/link-verify.ts`:

```ts
/**
 * Proving a link target is live (#186). This is deliberately the ONLY thing we
 * trust: we never ask a publishing plugin what URL it created, so WordPress,
 * the Vue static-site adapter, and every future adapter are all held to the
 * same test — does this URL answer 2xx right now?
 */
import type { LinkCandidate } from './links';

const VERIFY_TIMEOUT_MS = 5_000;
const VERIFY_CONCURRENCY = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; SeoPotionLinkCheck/1.0; +https://seopotion.co/bot)';

/** One URL, HEAD first (cheap) with a GET retry for servers that refuse HEAD. */
async function isLive(url: string): Promise<boolean> {
  for (const method of ['HEAD', 'GET'] as const) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (res.ok) return true;
      if (method === 'HEAD' && (res.status === 405 || res.status === 501)) continue;
      return false;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }
  return false;
}

/** Candidates whose URL is live. Anything unproven is dropped, never guessed. */
export async function verifyCandidates(candidates: LinkCandidate[]): Promise<LinkCandidate[]> {
  const live: LinkCandidate[] = [];
  for (let i = 0; i < candidates.length; i += VERIFY_CONCURRENCY) {
    const chunk = candidates.slice(i, i + VERIFY_CONCURRENCY);
    const checked = await Promise.all(chunk.map(async (c) => ((await isLive(c.url)) ? c : null)));
    live.push(...checked.filter((c): c is LinkCandidate => c !== null));
  }
  return live;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- link-verify`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/generation/src/link-verify.ts packages/shared/generation/tests/link-verify.test.ts && git commit -m "[generation] Verify link candidates are live over HTTP

Part of #186"
```

---

### Task 3: Context and type changes

**Files:**
- Modify: `packages/shared/generation/src/types.ts:3-28`
- Modify: `packages/shared/generation/src/context.ts`
- Modify: `packages/shared/generation/src/config.ts`
- Modify: `packages/shared/generation/src/index.ts`
- Modify (rename only, behaviour unchanged): `packages/shared/generation/src/outline.ts`, `packages/shared/generation/src/article.ts`
- Modify (fixtures): `packages/shared/generation/tests/outline.test.ts:5-21,58`, `packages/shared/generation/tests/prompts.test.ts:6-31`, `packages/shared/generation/tests/generate.test.ts:6-20`, `packages/shared/generation/tests/validate.test.ts:5`

**Why the rename is in this task:** renaming the `Outline` field breaks every
reader of it. Tasks 4 and 5 rewrite those readers properly, but this task must
leave `npm run check:all` green on its own, so it carries the minimal mechanical
rename and nothing more.

**Interfaces:**
- Consumes: `LinkCandidate` from `./links` (Task 1).
- Produces:
  - `GenerationContext.maxInternalLinks: number` and `GenerationContext.linkCandidates: LinkCandidate[]` — replacing `internalLinks: boolean`.
  - `Outline.internal_links: string[]` — replacing `internal_link_opportunities: string[]`.
  - `buildContext(org: Org, keyword: Keyword, linkCandidates?: LinkCandidate[]): GenerationContext`
  - `MAX_LINK_CANDIDATES: number` (25) exported from `./config`.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/generation/tests/links.test.ts` (append at end of file):

```ts
import type { Keyword, Org } from '@shared/schemas';
import { buildContext } from '../src/context';

const org = {
  id: 'o1',
  presets: {
    business: { name: 'Acme', language: 'English', country: 'US', description: 'widgets' },
    audience: { target: ['makers'], competitors: [] },
    blog: { sitemap_url: '', main_blog_url: 'https://a.com/blog', best_articles: [] },
    article_preferences: {
      content_seo: {
        article_style: 'practical',
        internal_links_count: 2,
        table_of_contents: true,
        llm_instructions: '',
      },
      engagement: { image_style: '', youtube_videos: true },
      publishing: { auto_publish: false },
    },
  },
} as unknown as Org;

const keyword = { keyword: 'best widgets' } as Keyword;

describe('buildContext link fields', () => {
  test('carries the raw preset count and the supplied candidates', () => {
    const ctx = buildContext(org, keyword, [{ title: 'One', url: 'https://a.com/blog/one' }]);
    expect(ctx.maxInternalLinks).toBe(2);
    expect(ctx.linkCandidates).toEqual([{ title: 'One', url: 'https://a.com/blog/one' }]);
  });

  test('defaults to no candidates when none are supplied', () => {
    expect(buildContext(org, keyword).linkCandidates).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- links`
Expected: FAIL — `maxInternalLinks` is undefined / `buildContext` takes 2 arguments.

- [ ] **Step 3: Write the implementation**

In `packages/shared/generation/src/types.ts`, replace the `internalLinks` line in `GenerationContext` and the `internal_link_opportunities` line in `Outline`, and add the import:

```ts
import type { SerpCompetitor } from '@shared/schemas';
import type { LinkCandidate } from './links';

export interface GenerationContext {
  businessName: string;
  businessDescription: string;
  language: string;
  country: string;
  audience: string;
  competitors: string[];
  articleStyle: string;
  // Ceiling on internal links, never a quota (#186). The pre-#186 `internalLinks`
  // boolean collapsed the 0-3 preset to yes/no, which is why a preset of 1 shipped
  // 3-6 links.
  maxInternalLinks: number;
  // Link targets already proven live. Empty means the article ships with no
  // internal links, whatever `maxInternalLinks` says.
  linkCandidates: LinkCandidate[];
  llmInstructions: string;
  keyword: string;
  articleType: string | null;
  intent: string | null;
  serpCompetitors: SerpCompetitor[];
}

export interface Outline {
  h1: string;
  meta_title: string;
  meta_description: string;
  slug: string;
  sections: { heading: string; intent: string }[];
  faqs: { question: string; answer: string }[];
  // URLs chosen from `ctx.linkCandidates` — already filtered and capped by
  // `parseOutline`, so everything here is approved (#186). Replaces the
  // pre-#186 `internal_link_opportunities`, which were topics the model invented
  // for itself and then had to invent hrefs for.
  internal_links: string[];
  cta: string;
}
```

In `packages/shared/generation/src/context.ts`, replace the whole file:

```ts
import type { Keyword, Org } from '@shared/schemas';
import type { LinkCandidate } from './links';
import type { GenerationContext } from './types';

/** Derive the generation context from the org, its presets, and the keyword brief.
 * `linkCandidates` are the verified internal-link targets the caller resolved
 * (#186); an empty list means this article gets no internal links. */
export function buildContext(
  org: Org,
  keyword: Keyword,
  linkCandidates: LinkCandidate[] = [],
): GenerationContext {
  const p = org.presets;
  if (!p) throw new Error('org has no presets');
  return {
    businessName: p.business.name,
    businessDescription: p.business.description,
    language: p.business.language,
    country: p.business.country,
    audience: p.audience.target.join(', '),
    competitors: p.audience.competitors,
    articleStyle: p.article_preferences.content_seo.article_style,
    maxInternalLinks: p.article_preferences.content_seo.internal_links_count,
    linkCandidates,
    llmInstructions: p.article_preferences.content_seo.llm_instructions,
    keyword: keyword.keyword,
    articleType: keyword.article_type ?? null,
    intent: keyword.intent ?? null,
    serpCompetitors: keyword.serp_competitors ?? [],
  };
}
```

Append to `packages/shared/generation/src/config.ts`:

```ts
/** Published articles considered as internal-link targets per generation (#186).
 * Bounds both the outline prompt and the HTTP verification fan-out. */
export const MAX_LINK_CANDIDATES = 25;
```

In `packages/shared/generation/src/index.ts`, update the config export line and add the two new modules (keep the file alphabetically organized — Biome will reorder imports but not these export statements, so place them by hand):

```ts
export { buildArticlePrompt } from './article';
export {
  HUMANIZE,
  INLINE_IMAGE_COUNT,
  MAX_GENERATION_ATTEMPTS,
  MAX_LINK_CANDIDATES,
} from './config';
export { buildContext } from './context';
export { generateArticle } from './generate';
export { buildHumanizePrompt } from './humanize';
export type { ImagePlan, ImagePlanInput } from './images';
export {
  buildImagePlanPrompt,
  extractH2s,
  ImagePlanSchema,
  injectBlockAfterHeading,
  injectImageAfterHeading,
  parseImagePlan,
} from './images';
export { parseJsonObject } from './json';
export { verifyCandidates } from './link-verify';
export type { LinkCandidate, MarkdownLink, PublishedArticleInput } from './links';
export {
  deriveCandidates,
  extractLinks,
  normalizeUrl,
  publishedArticleUrl,
  sanitizeLinks,
} from './links';
export { buildOutlinePrompt, OutlineSchema, parseOutline } from './outline';
export { buildSemanticCheckPrompt, parseSemanticResult, SemanticResultSchema } from './semantic';
export type * from './types';
export { countWords, validateArticle } from './validate';
export type { VideoPickInput } from './video';
export {
  buildVideoEmbed,
  buildVideoPickPrompt,
  languageCodeFromName,
  parseVideoPick,
  VideoPickSchema,
} from './video';
```

- [ ] **Step 4: Mechanical rename in the two readers of the renamed field**

These keep the package compiling; Tasks 4 and 5 replace both files properly.

In `packages/shared/generation/src/outline.ts`, rename the schema field (line 13) and the shape line in the system prompt (line 25):

```ts
  internal_links: z.array(z.string()).default([]),
```

```ts
    '  "internal_links": string[], "cta": string }',
```

In `packages/shared/generation/src/article.ts`, replace the three references to the old names (lines 13, 25-26):

```ts
    ctx.maxInternalLinks > 0 && outline.internal_links.length
      ? 'Where natural, weave in the suggested internal-link topics as descriptive anchor text.'
      : '',
```

```ts
    outline.internal_links.length
      ? `Internal-link topics: ${outline.internal_links.join(' | ')}`
      : '',
```

- [ ] **Step 5: Update the existing test fixtures**

Four test files build a `GenerationContext` literal and will no longer typecheck. In each, replace the `internalLinks: <bool>,` line with the two new fields:

`packages/shared/generation/tests/outline.test.ts` (line 13) and `packages/shared/generation/tests/prompts.test.ts` (line 14):

```ts
  maxInternalLinks: 0,
  linkCandidates: [],
```

`packages/shared/generation/tests/generate.test.ts` (line 14): same two lines.

In `packages/shared/generation/tests/prompts.test.ts`, the `outline` fixture also needs its link field renamed (line 29):

```ts
  internal_links: [],
```

`packages/shared/generation/tests/validate.test.ts` (line 5) — the cast fixture must carry the link fields, because `validateArticle` will read them in Task 6:

```ts
const ctx = {
  keyword: 'best widgets',
  maxInternalLinks: 0,
  linkCandidates: [],
} as GenerationContext;
```

`packages/shared/generation/tests/outline.test.ts` (line 58) — the assertion on the renamed field:

```ts
    expect(out.internal_links).toEqual([]);
```

- [ ] **Step 6: Run the generation suite and the typechecker**

Run: `npm test -- packages/shared/generation && npm run check`
Expected: PASS — the whole generation suite green and the typecheck clean. This task must not leave either red.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/generation && git commit -m "[generation] Replace internalLinks boolean with count + candidates

The #73 shim collapsed the 0-3 preset to yes/no, so the prompt never
learned the number.

Part of #186"
```

---

### Task 4: Outline schema, prompt, and candidate-filtered parse

**Files:**
- Modify: `packages/shared/generation/src/outline.ts`
- Modify: `packages/shared/generation/tests/outline.test.ts`

**Interfaces:**
- Consumes: `GenerationContext.linkCandidates` / `.maxInternalLinks` (Task 3), `normalizeUrl` (Task 1).
- Produces: `parseOutline(text: string, ctx: GenerationContext): Outline` — **signature change, now takes ctx**. Returns `internal_links` already filtered to the candidate set, de-duplicated, and capped at `ctx.maxInternalLinks`.

- [ ] **Step 1: Write the failing test**

Replace the body of `packages/shared/generation/tests/outline.test.ts` after the `ctx` fixture with:

```ts
const withCandidates = (max: number): GenerationContext => ({
  ...ctx,
  maxInternalLinks: max,
  linkCandidates: [
    { title: 'Widget Guide', url: 'https://a.com/blog/widget-guide' },
    { title: 'Widget Care', url: 'https://a.com/blog/widget-care' },
  ],
});

const outlineJson = (internal_links: string[]) =>
  JSON.stringify({
    h1: 'Best Widgets Ranked',
    meta_title: 't',
    meta_description: 'd',
    slug: 'best-widgets',
    sections: [{ heading: 'H', intent: 'i' }],
    internal_links,
  });

describe('outline', () => {
  test('buildOutlinePrompt includes keyword, language, and JSON instruction', () => {
    const msgs = buildOutlinePrompt(ctx);
    expect(msgs[0]!.role).toBe('system');
    const joined = msgs.map((m) => m.content).join('\n');
    expect(joined).toContain('best widgets');
    expect(joined).toContain('English');
    expect(joined.toLowerCase()).toContain('json');
  });

  test('buildOutlinePrompt lists ranking SERP articles with title and url (#144)', () => {
    const joined = buildOutlinePrompt(ctx)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('Top 10 Widgets');
    expect(joined).toContain('https://a.com/best-widgets');
  });

  test('buildOutlinePrompt falls back to domain for legacy entries without title (#144)', () => {
    const legacy = {
      ...ctx,
      serpCompetitors: [{ rank: null, url: null, domain: 'a.com', title: null }],
    };
    const joined = buildOutlinePrompt(legacy)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('a.com');
  });

  test('buildOutlinePrompt lists candidates with their exact URLs and the ceiling (#186)', () => {
    const joined = buildOutlinePrompt(withCandidates(2))
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('https://a.com/blog/widget-guide');
    expect(joined).toContain('Widget Guide');
    expect(joined).toContain('at most 2');
  });

  test('buildOutlinePrompt tells the model there is nothing to link when there are no candidates (#186)', () => {
    const joined = buildOutlinePrompt(ctx)
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('no internal link candidates');
  });

  test('parseOutline parses fenced JSON and applies defaults', () => {
    const out = parseOutline(
      '```json\n{"h1":"Best Widgets Ranked","meta_title":"t","meta_description":"d","slug":"best-widgets","sections":[{"heading":"H","intent":"i"}]}\n```',
      ctx,
    );
    expect(out.h1).toBe('Best Widgets Ranked');
    expect(out.faqs).toEqual([]);
    expect(out.internal_links).toEqual([]);
  });

  test('parseOutline rejects an outline with no sections', () => {
    expect(() =>
      parseOutline(
        '{"h1":"x","meta_title":"t","meta_description":"d","slug":"s","sections":[]}',
        ctx,
      ),
    ).toThrow();
  });

  test('parseOutline keeps candidate URLs and drops invented ones (#186)', () => {
    const out = parseOutline(
      outlineJson(['https://a.com/blog/widget-guide', '/features/invented', '#']),
      withCandidates(3),
    );
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline caps at maxInternalLinks and de-duplicates (#186)', () => {
    const out = parseOutline(
      outlineJson([
        'https://a.com/blog/widget-guide',
        'https://a.com/blog/widget-guide',
        'https://a.com/blog/widget-care',
      ]),
      withCandidates(1),
    );
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline canonicalizes a trailing-slash variant to our URL (#186)', () => {
    const out = parseOutline(outlineJson(['https://a.com/blog/widget-guide/']), withCandidates(2));
    expect(out.internal_links).toEqual(['https://a.com/blog/widget-guide']);
  });

  test('parseOutline yields no links when there are no candidates (#186)', () => {
    const out = parseOutline(outlineJson(['https://a.com/blog/widget-guide']), ctx);
    expect(out.internal_links).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- outline`
Expected: FAIL — `parseOutline` takes 1 argument; `internal_links` undefined.

- [ ] **Step 3: Write the implementation**

Replace `packages/shared/generation/src/outline.ts`:

```ts
import type { LlmMessage } from '@shared/providers';
import { z } from 'zod';
import { parseJsonObject } from './json';
import { normalizeUrl } from './links';
import type { GenerationContext, Outline } from './types';

export const OutlineSchema = z.object({
  h1: z.string(),
  meta_title: z.string(),
  meta_description: z.string(),
  slug: z.string(),
  sections: z.array(z.object({ heading: z.string(), intent: z.string() })).min(1),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  // URLs the model selected from the candidates we supplied. Unvetted here —
  // `parseOutline` is what filters them down to the approved set (#186).
  internal_links: z.array(z.string()).default([]),
  cta: z.string().default(''),
});

export function buildOutlinePrompt(ctx: GenerationContext): LlmMessage[] {
  const canLink = ctx.linkCandidates.length > 0 && ctx.maxInternalLinks > 0;

  const system = [
    'You are an expert SEO content strategist.',
    'Produce a JSON outline for one blog article that can rank for the target keyword.',
    'Respond with ONLY a JSON object of this shape:',
    '{ "h1": string, "meta_title": string, "meta_description": string, "slug": string,',
    '  "sections": [{ "heading": string, "intent": string }],',
    '  "faqs": [{ "question": string, "answer": string }],',
    '  "internal_links": string[], "cta": string }',
    'Rules: h1 must NOT be identical to the keyword; meta_title <= 60 chars;',
    'meta_description between 120 and 160 chars; slug is kebab-case; at least 3 sections.',
    '"internal_links" may contain ONLY URLs copied verbatim from the candidate list.',
    'Never invent, shorten, or modify a URL, and never use a placeholder such as "#".',
  ].join('\n');

  const user = [
    `Business: ${ctx.businessName} — ${ctx.businessDescription}`,
    `Audience: ${ctx.audience}`,
    `Language: ${ctx.language} (${ctx.country})`,
    `Target keyword: ${ctx.keyword}`,
    ctx.articleType ? `Article type: ${ctx.articleType}` : '',
    ctx.intent ? `Search intent: ${ctx.intent}` : '',
    ctx.competitors.length
      ? `Competitors to differentiate from (never promote them): ${ctx.competitors.join(', ')}`
      : '',
    ctx.serpCompetitors.length
      ? `Articles currently ranking for this keyword (differentiate the angle and craft a stronger title; never copy them):\n${ctx.serpCompetitors
          .map((r) => `${r.rank ?? '-'}. ${r.title ?? r.domain}${r.url ? ` (${r.url})` : ''}`)
          .join('\n')}`
      : '',
    canLink
      ? `Internal link candidates — already-published pages of this business. Pick at most ${ctx.maxInternalLinks}, and ONLY ones genuinely related to this article; pick none if none fit. Copy the URL exactly into "internal_links":\n${ctx.linkCandidates
          .map((c) => `${c.title} — ${c.url}`)
          .join('\n')}`
      : 'There are no internal link candidates: "internal_links" must be an empty array.',
    ctx.llmInstructions ? `Extra instructions: ${ctx.llmInstructions}` : '',
    `Write all text in ${ctx.language}.`,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Parse the outline and reduce `internal_links` to targets we can vouch for:
 * each must match a supplied candidate, appear once, and fit under the ceiling.
 * Selections are rewritten to OUR canonical URL, so a trailing-slash variant
 * from the model still resolves (#186).
 */
export function parseOutline(text: string, ctx: GenerationContext): Outline {
  const parsed = OutlineSchema.parse(parseJsonObject(text));
  const approved = new Map(ctx.linkCandidates.map((c) => [normalizeUrl(c.url), c.url]));
  const internal_links: string[] = [];
  for (const selected of parsed.internal_links) {
    const canonical = approved.get(normalizeUrl(selected));
    if (!canonical || internal_links.includes(canonical)) continue;
    if (internal_links.length >= ctx.maxInternalLinks) break;
    internal_links.push(canonical);
  }
  return { ...parsed, internal_links };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- outline`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/generation/src/outline.ts packages/shared/generation/tests/outline.test.ts && git commit -m "[generation] Select internal links from verified candidates in the outline

Part of #186"
```

---

### Task 5: Article prompt receives resolved URLs

**Files:**
- Modify: `packages/shared/generation/src/article.ts`
- Modify: `packages/shared/generation/tests/prompts.test.ts`

**Interfaces:**
- Consumes: `Outline.internal_links` (Task 4), `ctx.linkCandidates` (Task 3), `normalizeUrl` (Task 1).
- Produces: no signature change — `buildArticlePrompt(ctx: GenerationContext, outline: Outline): LlmMessage[]`.

- [ ] **Step 1: Write the failing test**

Append to the `describe('article + humanize prompts', ...)` block in `packages/shared/generation/tests/prompts.test.ts`:

```ts
  test('passes the selected URL and its title, and forbids other links (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 2,
      linkCandidates: [{ title: 'Widget Guide', url: 'https://a.com/blog/widget-guide' }],
    };
    const joined = buildArticlePrompt(linked, {
      ...outline,
      internal_links: ['https://a.com/blog/widget-guide'],
    })
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('https://a.com/blog/widget-guide');
    expect(joined).toContain('Widget Guide');
    expect(joined).toContain('no other links');
  });

  test('forbids hyperlinks outright when nothing was selected (#186)', () => {
    const joined = buildArticlePrompt(ctx, { ...outline, internal_links: [] })
      .map((m) => m.content)
      .join('\n');
    expect(joined).toContain('Do not include any hyperlinks');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- prompts`
Expected: FAIL — the prompt contains neither the URL nor the prohibition.

- [ ] **Step 3: Write the implementation**

Replace `packages/shared/generation/src/article.ts`:

```ts
import type { LlmMessage } from '@shared/providers';
import { normalizeUrl } from './links';
import type { GenerationContext, Outline } from './types';

export function buildArticlePrompt(ctx: GenerationContext, outline: Outline): LlmMessage[] {
  // Resolved at the outline step and already filtered to approved targets (#186);
  // the model receives concrete URLs or none, never a topic to invent an href for.
  const linkLines = outline.internal_links
    .map((url) => {
      const candidate = ctx.linkCandidates.find((c) => normalizeUrl(c.url) === normalizeUrl(url));
      return candidate ? `${candidate.title} — ${candidate.url}` : null;
    })
    .filter((line): line is string => line !== null);

  const system = [
    'You are an expert long-form SEO writer.',
    'Write a complete, publish-ready blog article in GitHub-flavored Markdown.',
    'Start with a single H1 (# ...), then H2 (## ...) sections following the outline.',
    'Include an engaging introduction before the first H2 and a concluding section.',
    'Use the target keyword naturally; never keyword-stuff.',
    'Do not invent unverifiable facts about the business. Never promote competitors.',
    `Write the entire article in ${ctx.language}.`,
    linkLines.length
      ? 'Link to the internal pages listed below, at most once each, using descriptive anchor text. Use those exact URLs verbatim — never invent, shorten, or alter one — and include no other links of any kind.'
      : 'Do not include any hyperlinks.',
  ]
    .filter(Boolean)
    .join('\n');

  const user = [
    `Target keyword: ${ctx.keyword}`,
    `H1: ${outline.h1}`,
    `Sections: ${outline.sections.map((s) => s.heading).join(' | ')}`,
    outline.faqs.length ? `FAQs to answer: ${outline.faqs.map((f) => f.question).join(' | ')}` : '',
    linkLines.length ? `Internal links you may use (title — URL):\n${linkLines.join('\n')}` : '',
    outline.cta ? `Call to action: ${outline.cta}` : '',
    ctx.articleStyle ? `Style: ${ctx.articleStyle}` : '',
    ctx.llmInstructions ? `Extra instructions: ${ctx.llmInstructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- prompts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/generation/src/article.ts packages/shared/generation/tests/prompts.test.ts && git commit -m "[generation] Give the article prompt real URLs or none

Part of #186"
```

---

### Task 6: Sanitize in the pipeline and validate as backstop

**Files:**
- Modify: `packages/shared/generation/src/generate.ts:31-56`
- Modify: `packages/shared/generation/src/validate.ts`
- Modify: `packages/shared/generation/tests/generate.test.ts`
- Modify: `packages/shared/generation/tests/validate.test.ts`

**Interfaces:**
- Consumes: `sanitizeLinks`, `extractLinks`, `normalizeUrl` (Task 1); `parseOutline(text, ctx)` (Task 4).
- Produces: validation failure code `'illegal_link'`. No signature changes — `validateArticle(article, ctx)` reads the ceiling and candidates off `ctx`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/generation/tests/validate.test.ts` (inside the existing `describe('validateArticle', ...)`):

```ts
  test('an unapproved link fails illegal_link (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [{ title: 'One', url: 'https://a.com/blog/one' }],
    } as GenerationContext;
    const content = `${goodBody}\n\nsee [features](/features/invented)\n`;
    const codes = validateArticle({ ...goodArticle, content }, linked).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('an approved link within the ceiling passes (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [{ title: 'One', url: 'https://a.com/blog/one' }],
    } as GenerationContext;
    const content = `${goodBody}\n\nsee [our guide](https://a.com/blog/one)\n`;
    expect(validateArticle({ ...goodArticle, content }, linked)).toEqual([]);
  });

  test('more links than the ceiling fails illegal_link (#186)', () => {
    const linked = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [
        { title: 'One', url: 'https://a.com/blog/one' },
        { title: 'Two', url: 'https://a.com/blog/two' },
      ],
    } as GenerationContext;
    const content = `${goodBody}\n\n[a](https://a.com/blog/one) [b](https://a.com/blog/two)\n`;
    const codes = validateArticle({ ...goodArticle, content }, linked).map((f) => f.code);
    expect(codes).toContain('illegal_link');
  });

  test('an image URL is not treated as a link (#186)', () => {
    const content = `${goodBody}\n\n![cover](https://cdn.seopotion.co/x.webp)\n`;
    expect(validateArticle({ ...goodArticle, content }, ctx)).toEqual([]);
  });
```

Append to `packages/shared/generation/tests/generate.test.ts` (inside the existing `describe('generateArticle', ...)`):

```ts
  test('strips a link the model invented despite the prompt (#186)', async () => {
    const linked: GenerationContext = {
      ...ctx,
      maxInternalLinks: 1,
      linkCandidates: [{ title: 'Guide', url: 'https://a.com/blog/guide' }],
    };
    const outlineWithLink = JSON.stringify({
      ...JSON.parse(outlineJson),
      internal_links: ['https://a.com/blog/guide'],
    });
    const md = `${articleMd}\nRead our [guide](https://a.com/blog/guide) and our [pricing](/pricing/invented).\n`;
    const llm = mockLlm([outlineWithLink, md, md, '{"pass":true,"reasons":[]}']);

    const result = await generateArticle({ ctx: linked, llm });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.article.content).toContain('[guide](https://a.com/blog/guide)');
      expect(result.article.content).not.toContain('/pricing/invented');
      expect(result.article.content).toContain('pricing');
    }
  });

  test('with no candidates every link is stripped (#186)', async () => {
    const md = `${articleMd}\nSee [features](/features/invented) and [this](#).\n`;
    const llm = mockLlm([outlineJson, md, md, '{"pass":true,"reasons":[]}']);

    const result = await generateArticle({ ctx, llm });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.article.content).not.toContain('](');
      expect(result.article.content).toContain('features');
    }
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- validate generate`
Expected: FAIL — no `illegal_link` code exists; invented links survive into the article.

- [ ] **Step 3: Write the implementation**

In `packages/shared/generation/src/generate.ts`, add the import and change the outline parse plus the post-humanize step. The imports at the top become:

```ts
import type { LlmClient, LlmUsage } from '@shared/providers';
import { buildArticlePrompt } from './article';
import { HUMANIZE } from './config';
import { buildHumanizePrompt } from './humanize';
import { sanitizeLinks } from './links';
import { buildOutlinePrompt, parseOutline } from './outline';
import { buildSemanticCheckPrompt, parseSemanticResult } from './semantic';
import type { GeneratedArticle, GenerationContext, ValidationFailure } from './types';
import { validateArticle } from './validate';
```

Change the parse call (was `parseOutline(outlineRes.text)`):

```ts
  const outline = parseOutline(outlineRes.text, ctx);
```

Insert the sanitize step immediately after the `if (HUMANIZE) { ... }` block and before `const failures = validateArticle(...)`:

```ts
  // Fail closed (#186): the model is asked for approved URLs only, but anything
  // it invented or over-placed is unwrapped to plain text here — before
  // validation, which then asserts the invariant as a backstop.
  content = sanitizeLinks(content, outline.internal_links, ctx.maxInternalLinks);
```

In `packages/shared/generation/src/validate.ts`, add the import:

```ts
import { extractLinks, normalizeUrl } from './links';
```

and append these checks inside `validateArticle`, just before `return failures;`:

```ts
  // Backstop for the sanitizer (#186). Reaching either branch means a link
  // survived sanitizeLinks, so the article must not ship.
  const approved = new Set(ctx.linkCandidates.map((c) => normalizeUrl(c.url)));
  const links = extractLinks(article.content);
  if (links.some((l) => !approved.has(normalizeUrl(l.url))))
    failures.push({ code: 'illegal_link', message: 'link target is not an approved internal link' });
  else if (links.length > ctx.maxInternalLinks)
    failures.push({
      code: 'illegal_link',
      message: `more than ${ctx.maxInternalLinks} internal links`,
    });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- packages/shared/generation`
Expected: PASS (entire generation suite green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/generation && git commit -m "[generation] Strip unapproved links and reject them in validation

Part of #186"
```

---

### Task 7: Worker builds and verifies candidates

**Files:**
- Modify: `apps/worker/src/generation.ts:1-17,60`
- Modify: `apps/worker/tests/generation.test.ts`

**Interfaces:**
- Consumes: `deriveCandidates`, `verifyCandidates`, `MAX_LINK_CANDIDATES`, `buildContext(org, keyword, candidates)`, `LinkCandidate` (Tasks 1–3); `ArticleRepo.listByOrg`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

In `apps/worker/tests/generation.test.ts`, extend the `@shared/db` mock (lines 4–23) so `ArticleRepo` also exposes `listByOrg`:

```ts
const {
  claimGeneration,
  findKeywordById,
  failGeneration,
  linkArticle,
  findOrgById,
  createArticle,
  listByOrg,
} = vi.hoisted(() => ({
  claimGeneration: vi.fn(async () => true),
  findKeywordById: vi.fn(),
  failGeneration: vi.fn(async () => {}),
  linkArticle: vi.fn(async () => {}),
  findOrgById: vi.fn(),
  createArticle: vi.fn(async (_doc: unknown) => ({ id: 'art1' })),
  listByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
}));
vi.mock('@shared/db', () => ({
  KeywordRepo: { claimGeneration, findById: findKeywordById, failGeneration, linkArticle },
  OrgRepo: { findById: findOrgById },
  ArticleRepo: { create: createArticle, listByOrg },
}));
```

Extend the `@shared/generation` mock (lines 25–29) so `verifyCandidates` is stubbed too:

```ts
const { generateArticle, verifyCandidates } = vi.hoisted(() => ({
  generateArticle: vi.fn(),
  verifyCandidates: vi.fn(async (c: unknown[]) => c),
}));
vi.mock('@shared/generation', async (orig) => ({
  ...(await orig<typeof import('@shared/generation')>()),
  generateArticle,
  verifyCandidates,
}));
```

Add this block at the end of the `describe('generation worker', ...)`:

```ts
  const linkingOrg = {
    ...org,
    presets: {
      ...org.presets,
      blog: { sitemap_url: '', main_blog_url: 'https://acme.com/blog', best_articles: [] },
      article_preferences: {
        ...org.presets.article_preferences,
        content_seo: { ...org.presets.article_preferences.content_seo, internal_links_count: 2 },
      },
    },
  };

  const published = {
    title: 'Widget Guide',
    slug: 'edited-later',
    publications: [{ slug: 'widget-guide', published_at: new Date('2026-01-01') }],
  };

  test('passes verified candidates from published articles into the context (#186)', async () => {
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listByOrg.mockResolvedValueOnce({ articles: [published], total: 1 });

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listByOrg).toHaveBeenCalledWith('o1', expect.objectContaining({ status: 'published' }));
    expect(verifyCandidates).toHaveBeenCalledWith([
      { title: 'Widget Guide', url: 'https://acme.com/blog/widget-guide' },
    ]);
    const passed = generateArticle.mock.calls[0]![0] as {
      ctx: { linkCandidates: unknown[]; maxInternalLinks: number };
    };
    expect(passed.ctx.maxInternalLinks).toBe(2);
    expect(passed.ctx.linkCandidates).toEqual([
      { title: 'Widget Guide', url: 'https://acme.com/blog/widget-guide' },
    ]);
  });

  test('a candidate that fails verification never reaches the context (#186)', async () => {
    findOrgById.mockResolvedValue(linkingOrg);
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);
    listByOrg.mockResolvedValueOnce({ articles: [published], total: 1 });
    verifyCandidates.mockResolvedValueOnce([]);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    const passed = generateArticle.mock.calls[0]![0] as { ctx: { linkCandidates: unknown[] } };
    expect(passed.ctx.linkCandidates).toEqual([]);
  });

  test('an org with internal_links_count 0 queries nothing (#186)', async () => {
    findOrgById.mockResolvedValue(org); // fixture has internal_links_count: 0
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listByOrg).not.toHaveBeenCalled();
    const passed = generateArticle.mock.calls[0]![0] as { ctx: { linkCandidates: unknown[] } };
    expect(passed.ctx.linkCandidates).toEqual([]);
  });

  test('an org with no main_blog_url gets no candidates (#186)', async () => {
    findOrgById.mockResolvedValue({
      ...linkingOrg,
      presets: { ...linkingOrg.presets, blog: { sitemap_url: '', main_blog_url: '', best_articles: [] } },
    });
    findKeywordById.mockResolvedValue(keyword);
    generateArticle.mockResolvedValue(okArticle);

    await handler(event({ org_id: 'o1', keyword_id: 'k1' }), {} as never, () => {});

    expect(listByOrg).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- apps/worker/tests/generation`
Expected: FAIL — `listByOrg` never called; `ctx.linkCandidates` is `[]` in the first test.

- [ ] **Step 3: Write the implementation**

In `apps/worker/src/generation.ts`, update the imports:

```ts
import { ArticleRepo, KeywordRepo, OrgRepo } from '@shared/db';
import {
  buildContext,
  buildVideoEmbed,
  buildVideoPickPrompt,
  deriveCandidates,
  extractH2s,
  generateArticle,
  injectBlockAfterHeading,
  languageCodeFromName,
  type LinkCandidate,
  MAX_LINK_CANDIDATES,
  parseVideoPick,
  verifyCandidates,
} from '@shared/generation';
import type { ArticleVideo, Org } from '@shared/schemas';
import { GenerateTask, isPaid } from '@shared/schemas';
```

Add this helper above the `handler` export (after the doc comment block, before `export const handler`):

```ts
/**
 * Internal-link targets for this org: its own published articles, each derived
 * to a URL and then proven live (#186). Anything unproven is dropped — an org
 * with nothing published, or no blog URL to build one from, gets no links at
 * all, whatever `internal_links_count` says.
 */
async function resolveLinkCandidates(org: Org): Promise<LinkCandidate[]> {
  const max = org.presets?.article_preferences.content_seo.internal_links_count ?? 0;
  const mainBlogUrl = org.presets?.blog.main_blog_url ?? '';
  if (max <= 0 || !mainBlogUrl.trim()) return [];
  const { articles } = await ArticleRepo.listByOrg(org.id, {
    status: 'published',
    limit: MAX_LINK_CANDIDATES,
    offset: 0,
  });
  const candidates = await verifyCandidates(deriveCandidates(mainBlogUrl, articles));
  logger.info('internal link candidates resolved', {
    derived: articles.length,
    verified: candidates.length,
  });
  return candidates;
}
```

Replace line 60 (`const ctx = buildContext(org, keyword);`) with:

```ts
      const ctx = buildContext(org, keyword, await resolveLinkCandidates(org));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- apps/worker/tests/generation`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker && git commit -m "[worker] Resolve verified internal-link candidates before generating

Part of #186"
```

---

### Task 8: One-off cleanup command for existing articles

**Files:**
- Modify: `packages/shared/db/src/repositories/article.repo.ts` (add `replaceContent` after `updateContent`, around line 152)
- Create: `apps/cli/src/lib/links.ts`
- Create: `apps/cli/tests/links.test.ts`
- Modify: `apps/cli/src/types.ts`
- Modify: `apps/cli/src/commands/db.ts`

**Interfaces:**
- Consumes: `deriveCandidates`, `verifyCandidates`, `sanitizeLinks`, `extractLinks` (Tasks 1–2); `OrgRepo.findById`, `ArticleRepo.listByOrg`.
- Produces:
  - `ArticleRepo.replaceContent(id: string, content: string): Promise<boolean>`
  - `cleanLinks(opts: { org?: string; apply: boolean }): Promise<Result<CleanLinksData>>`
  - `interface CleanLinksData { org: string; apply: boolean; scanned: number; changed: number; linksRemoved: number; publishedChanged: { id: string; title: string }[] }`

- [ ] **Step 1: Write the failing test**

Create `apps/cli/tests/links.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { findOrgById, listByOrg, replaceContent, closeDb } = vi.hoisted(() => ({
  findOrgById: vi.fn(),
  listByOrg: vi.fn(async () => ({ articles: [] as unknown[], total: 0 })),
  replaceContent: vi.fn(async () => true),
  closeDb: vi.fn(async () => {}),
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById: findOrgById },
  ArticleRepo: { listByOrg, replaceContent },
  closeDb,
}));

const { verifyCandidates } = vi.hoisted(() => ({
  verifyCandidates: vi.fn(async (c: unknown[]) => c),
}));
vi.mock('@shared/generation', async (orig) => ({
  ...(await orig<typeof import('@shared/generation')>()),
  verifyCandidates,
}));

import { cleanLinks } from '../src/lib/links';

const org = {
  id: 'o1',
  presets: {
    blog: { sitemap_url: '', main_blog_url: 'https://acme.com/blog', best_articles: [] },
    article_preferences: { content_seo: { internal_links_count: 1 } },
  },
};

const live = {
  id: 'a1',
  title: 'Widget Guide',
  slug: 'widget-guide',
  status: 'published',
  publications: [{ slug: 'widget-guide', published_at: new Date('2026-01-01') }],
  content: 'A clean article with no links.',
};

const dirty = {
  id: 'a2',
  title: 'Dirty',
  slug: 'dirty',
  status: 'generated',
  publications: [],
  content: 'See [features](/features/invented) and [this](#) and [guide](https://acme.com/blog/widget-guide).',
};

describe('cleanLinks', () => {
  beforeEach(() => vi.clearAllMocks());

  test('requires an org id', async () => {
    const res = await cleanLinks({ apply: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ORG_REQUIRED');
  });

  test('fails when the org does not exist', async () => {
    findOrgById.mockResolvedValue(null);
    const res = await cleanLinks({ org: 'nope', apply: false });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ORG_NOT_FOUND');
  });

  test('dry run reports what would change and writes nothing', async () => {
    findOrgById.mockResolvedValue(org);
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 }) // published candidates
      .mockResolvedValueOnce({ articles: [live, dirty], total: 2 }); // all articles

    const res = await cleanLinks({ org: 'o1', apply: false });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({ scanned: 2, changed: 1, linksRemoved: 2, apply: false });
    }
    expect(replaceContent).not.toHaveBeenCalled();
  });

  test('apply writes the sanitized content and keeps the live link', async () => {
    findOrgById.mockResolvedValue(org);
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 })
      .mockResolvedValueOnce({ articles: [dirty], total: 1 });

    const res = await cleanLinks({ org: 'o1', apply: true });

    expect(res.ok).toBe(true);
    expect(replaceContent).toHaveBeenCalledTimes(1);
    const [id, content] = replaceContent.mock.calls[0] as unknown as [string, string];
    expect(id).toBe('a2');
    expect(content).toBe(
      'See features and this and [guide](https://acme.com/blog/widget-guide).',
    );
  });

  test('lists published articles that changed, so they can be republished', async () => {
    findOrgById.mockResolvedValue(org);
    const dirtyPublished = { ...dirty, id: 'a3', title: 'Live One', status: 'published' };
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 })
      .mockResolvedValueOnce({ articles: [dirtyPublished], total: 1 });

    const res = await cleanLinks({ org: 'o1', apply: true });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.publishedChanged).toEqual([{ id: 'a3', title: 'Live One' }]);
  });

  test('with no verified candidates every link is removed', async () => {
    findOrgById.mockResolvedValue(org);
    verifyCandidates.mockResolvedValueOnce([]);
    listByOrg
      .mockResolvedValueOnce({ articles: [live], total: 1 })
      .mockResolvedValueOnce({ articles: [dirty], total: 1 });

    const res = await cleanLinks({ org: 'o1', apply: true });

    expect(res.ok).toBe(true);
    const [, content] = replaceContent.mock.calls[0] as unknown as [string, string];
    expect(content).toBe('See features and this and guide.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- apps/cli/tests/links`
Expected: FAIL — `Failed to resolve import "../src/lib/links"`.

- [ ] **Step 3: Add the repository method**

In `packages/shared/db/src/repositories/article.repo.ts`, insert after `updateContent` (which ends at line 152):

```ts
  /**
   * Overwrite `content` alone, leaving `updated_at` untouched — that field means
   * "last editor save", and the one-off internal-link cleanup (#186) is not one.
   */
  async replaceContent(id: string, content: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { content } },
    );
    return res.matchedCount > 0;
  },
```

- [ ] **Step 4: Write the CLI lib**

Create `apps/cli/src/lib/links.ts`:

```ts
/**
 * One-off cleanup of the dead internal links generated before #186: every link
 * that is not a verified, published page of the same org is unwrapped to plain
 * anchor text, using the exact sanitizer the generation pipeline now runs.
 *
 * Dry run by default. Published articles that changed are listed in the result
 * so an operator can republish them — this command never publishes anything.
 */
import { ArticleRepo, closeDb, OrgRepo } from '@shared/db';
import { deriveCandidates, extractLinks, sanitizeLinks, verifyCandidates } from '@shared/generation';
import { type CleanLinksData, fail, ok, type Result } from '../types';

const MAX_ARTICLES = 500;

export async function cleanLinks(opts: {
  org?: string;
  apply: boolean;
}): Promise<Result<CleanLinksData>> {
  if (!opts.org) {
    return fail('ORG_REQUIRED', 'Pass --org <id>.', 'Find it with `npm run cli -- db set-plan`.');
  }
  try {
    const org = await OrgRepo.findById(opts.org);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id ${opts.org}.`);

    const mainBlogUrl = org.presets?.blog.main_blog_url ?? '';
    const max = org.presets?.article_preferences.content_seo.internal_links_count ?? 0;

    const { articles: publishedArticles } = await ArticleRepo.listByOrg(org.id, {
      status: 'published',
      limit: MAX_ARTICLES,
      offset: 0,
    });
    const allowed = mainBlogUrl.trim()
      ? await verifyCandidates(deriveCandidates(mainBlogUrl, publishedArticles))
      : [];
    const allowedUrls = allowed.map((c) => c.url);

    const { articles } = await ArticleRepo.listByOrg(org.id, { limit: MAX_ARTICLES, offset: 0 });
    let changed = 0;
    let linksRemoved = 0;
    const publishedChanged: { id: string; title: string }[] = [];

    for (const article of articles) {
      const cleaned = sanitizeLinks(article.content, allowedUrls, max);
      if (cleaned === article.content) continue;
      changed += 1;
      linksRemoved += extractLinks(article.content).length - extractLinks(cleaned).length;
      if (article.status === 'published') {
        publishedChanged.push({ id: article.id, title: article.title });
      }
      if (opts.apply) await ArticleRepo.replaceContent(article.id, cleaned);
    }

    return ok({
      org: org.id,
      apply: opts.apply,
      scanned: articles.length,
      changed,
      linksRemoved,
      publishedChanged,
    });
  } catch (e) {
    return fail('CLEAN_LINKS_FAILED', (e as Error).message);
  } finally {
    await closeDb();
  }
}
```

Append to `apps/cli/src/types.ts`:

```ts
/** `db clean-links` report (#186). `publishedChanged` are live articles whose
 * content changed — republish them so the fix reaches the customer's site. */
export interface CleanLinksData {
  org: string;
  apply: boolean;
  scanned: number;
  changed: number;
  linksRemoved: number;
  publishedChanged: { id: string; title: string }[];
}
```

- [ ] **Step 5: Wire the subcommand**

In `apps/cli/src/commands/db.ts`, add this entry to `subCommands` after `'set-plan'`:

```ts
    'clean-links': defineCommand({
      meta: {
        name: 'clean-links',
        description: 'Unwrap dead internal links in existing articles (#186); dry run by default',
      },
      args: {
        org: { type: 'string', description: 'Org id to clean' },
        apply: { type: 'boolean', description: 'Write the changes (default: dry run)', default: false },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { cleanLinks } = await import('../lib/links');

          emitter.warn('Applies to whatever MONGODB_URI targets — never run this against prod.');
          emitter.step('db:clean-links', 'start');

          const result = await cleanLinks({
            org: args.org as string | undefined,
            apply: args.apply as boolean,
          });
          emitter.step('db:clean-links', result.ok ? 'done' : 'fail');
          if (result.ok && result.data.publishedChanged.length) {
            emitter.warn(
              `${result.data.publishedChanged.length} PUBLISHED article(s) changed — republish them so the customer's site picks up the fix.`,
            );
          }
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- apps/cli`
Expected: PASS (all CLI tests, including the 6 new ones).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/db apps/cli && git commit -m "[cli] Add db clean-links to strip dead internal links

Part of #186"
```

---

### Task 9: Documentation and full verification

**Files:**
- Modify: `PROGRESS.md:52`
- Verify: whole repo

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Update PROGRESS.md**

Append this sentence to the end of the line-52 bullet (the `✅ Article generation (#55)` entry), keeping it to the existing one-line-per-entry style:

```
Internal links point only at the org's own published pages, derived from `presets.blog.main_blog_url` + the published slug and HTTP-verified before generation; unapproved or over-ceiling links are unwrapped and `validate.ts` rejects survivors — [#186](https://github.com/seopotion/seo/issues/186). Pre-#186 articles are cleaned with `npm run cli -- db clean-links --org <id> --apply`
```

- [ ] **Step 2: Run the full verification suite**

Run each and confirm the output before claiming success:

```bash
npm run lint && npm run check:all && npm test
```

Expected: Biome reports no errors; all three typecheck passes succeed; the whole Vitest suite is green.

- [ ] **Step 3: Confirm the acceptance criteria by inspection**

Check each against the code you wrote, and note any that are not met:

- A generated article can contain `#` or `example.com` only if it is in `ctx.linkCandidates` — impossible, since candidates come from `deriveCandidates` + a live HTTP check (Tasks 1, 2, 7).
- No published articles ⇒ `resolveLinkCandidates` returns `[]` ⇒ `sanitizeLinks(content, [], n)` removes every link (Tasks 1, 7).
- Placed links are verified URLs of the org's own published articles, chosen for relatedness by the outline model (Tasks 2, 4).
- `internal_links_count` is a ceiling in three places: `parseOutline` caps, `sanitizeLinks` caps, `validateArticle` rejects (Tasks 4, 6).
- `validate.ts` rejects an unresolvable link via `illegal_link` (Task 6).
- Existing articles are handled by `db clean-links`; published ones are reported for republishing (Task 8).

- [ ] **Step 4: Commit**

```bash
git add PROGRESS.md && git commit -m "[docs] Record internal linking in PROGRESS

Part of #186"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin claude/issue-186-0ce2e5
```

Open the PR into `dev` with a body that explains the fix, notes that generation-time verification is the v1 boundary (publish-time re-verification and the customer's pre-existing pages are deliberately out of scope), states that the cleanup command must still be run against staging for both customer orgs, and ends with `Closes #186`.

---

## Self-Review

**Spec coverage:** §1 candidate assembly → Tasks 1, 2, 7. §2 prompt/schema → Tasks 3, 4, 5. §3 sanitize + validate → Tasks 1, 6. §4 cleanup → Task 8. §5 testing → tests in every task. All five acceptance criteria are traced in Task 9 Step 3. The sixth ("decide what happens to the 24 existing articles") is decided in the spec and executed by Task 8, with the republish left to an operator — the PR body says so.

**Deviation from the spec, deliberate:** the spec wrote the outline field as `internal_links: {url}[]`; the plan uses `string[]`. Nothing else was ever carried in the object, and a bare URL list is easier for the model to emit and to filter. No behavioural difference.

**Known limitation, recorded:** `LINK_RE` matches inline links only. Reference-style links (`[a][b]`) and autolinks (`<https://…>`) are neither sanitized nor detected by validation. Every one of the 32 observed bad targets was an inline link, and the article prompt never asks for other forms; if one ever appears it would survive, which is why this is written down rather than left implicit.

**Type consistency:** `LinkCandidate` (Task 1) is what `ctx.linkCandidates` holds (Task 3), what `verifyCandidates` returns (Task 2), and what `resolveLinkCandidates` returns (Task 7). `sanitizeLinks(content, allowedUrls: string[], max)` is called with `outline.internal_links` (Task 6) and `allowedUrls` (Task 8) — both `string[]`. `parseOutline(text, ctx)` is called with ctx in Task 6 and in every Task 4 test. `normalizeUrl` is used identically in `links.ts`, `outline.ts`, `article.ts`, and `validate.ts`.
