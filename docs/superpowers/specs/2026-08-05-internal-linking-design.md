# Internal linking — design ([#186](https://github.com/seopotion/seo/issues/186))

**Date:** 2026-08-05
**Status:** Approved design, pre-implementation

## Problem

Articles are generated with internal links, but nothing decides what those links point
at. The outline step asks the LLM to invent "internal link topics" (free strings), the
article prompt tells it to weave them in as anchor text, and never supplies an href — so
the model invents targets. Every link ever generated is broken: across 28 staging
articles, 60 bare `#`, 4 `example.com`, ~32 unique invented site paths, all 404. Three
articles are already published into a customer repo. Nothing in `validate.ts` looks at
links, so this ships silently.

A separate but related defect: `internal_links_count` (0–3, preset) is collapsed to a
boolean in `buildContext` (`internal_links_count > 0`) — a leftover shim from #73 — so
the preset number never reaches the prompt, and a preset of 1 yields 3–6 links.

## Core rule

**Only ever emit links to pages we have proven live, and fail closed.** No candidates
(or no verified candidates) means zero links, whatever `internal_links_count` says. The
count is a ceiling, never a quota. Anything unresolved is dropped, never guessed.

## Key facts discovered during design

- We do not store a live URL anywhere. `article.publications[]` records
  `{provider, ref, slug}`; our WordPress plugin returns only a `post_id` (no permalink),
  and for static-site the URL hierarchy is explicitly the client site's concern
  (the Vue adapter renders `/blog/<slug>`).
- `presets.blog.main_blog_url` (scanned at setup) is the only blog-base URL we hold.
- `ArticleRepo.listPublishedTo()` already lists an org's published articles.
- The `table_of_contents` preset is not implemented in generation — no legitimate
  in-page `#anchor` links exist, so stripping every unapproved link is safe.

## Decisions (with alternatives considered)

1. **URL source: derive + verify.** Build each candidate URL as
   `main_blog_url` + `/` + actually-published slug, then HTTP-verify it at generation
   time (redirects followed, final 2xx, short timeout); non-2xx candidates are dropped
   and logged. Chosen over (a) trusting the derived URL blind — a wrong permalink
   pattern would mass-produce dead links again — and (b) recording the real URL at
   publish time, which requires extending the WordPress plugin and the static-site
   adapter contract. Derive+verify is provider-agnostic by construction: WordPress, the
   Vue adapter, and any future adapter all pass the same "does this URL return 2xx"
   test, with no per-plugin contract additions.
2. **Relatedness: judged inside the existing outline step.** The outline prompt
   receives the candidate list (title + verified URL) and picks up to N genuinely
   related ones, or none. Chosen over a separate LLM selection pass (extra round-trip
   for a judgment the outline call can make) and embeddings (new infra; orgs have
   dozens of articles at most today).
3. **Timing: generation-time verification only.** Links are decided and verified when
   the linking article is *generated*. A target unpublished between generation and
   publish of the linking article slips through; accepted for v1 (the window is minutes
   under auto-publish, and unpublishing is rare). Publish-time re-verification was
   considered and deferred.
4. **Enforcement: strip and continue, validate as backstop.** Post-process the
   generated Markdown: unwrap (keep anchor text, remove link) any link whose target is
   not in the approved set, and any links beyond the ceiling. `validate.ts` then
   asserts the invariant; a violation surviving sanitization is a sanitizer bug and
   fails the article. Chosen over rejecting the article outright, which would turn a
   common model quirk (one extra link) into a wasted multi-call generation run.
5. **Existing articles: strip everywhere, republish the live 3.** One-off CLI cleanup
   reusing the same sanitizer across all articles of all orgs; the 3 published ones are
   then republished through the existing publish path. Chosen over stripping only the
   published 3 (the other 21 would ship dead links later) and regenerating all 24
   (burns LLM cost and discards edits over bad hrefs).

## Design

### 1. Candidate assembly (worker, at generation time)

In `apps/worker`, before the generation pipeline runs, when
`presets.article_preferences.content_seo.internal_links_count > 0`:

- List the org's published articles (`ArticleRepo`, `status: 'published'` /
  `publications[]` non-empty).
- For each, derive the URL: `presets.blog.main_blog_url` with trailing slash trimmed,
  `/`, the slug of the most recent `publications[]` entry (the slug it actually went
  live under — `article.slug` can be edited afterwards).
- HTTP-verify each derived URL from the worker: follow redirects, require a final 2xx,
  short timeout, small concurrency. Drop and log failures.
- Result: `candidates: { title: string; url: string }[]`.

Empty `main_blog_url`, no published articles, or all verifications failing ⇒ empty
candidate list ⇒ the article is generated with zero internal links. The HTTP
verification lives in the worker (which already makes outbound calls for scraping and
YouTube); URL derivation and sanitization are pure functions in `@shared/generation`.

### 2. Prompt & schema changes (`@shared/generation`)

- `GenerationContext` (`types.ts` / `context.ts`): remove `internalLinks: boolean`
  (the #73 shim); add `maxInternalLinks: number` (the raw `internal_links_count`) and
  `linkCandidates: { title: string; url: string }[]`. `buildContext(org, keyword,
  candidates)` gains the candidates parameter, supplied by the worker.
- **Outline step** (`outline.ts`): `internal_link_opportunities: string[]` is replaced
  by `internal_links: { url: string }[]`. The prompt lists the candidates and
  instructs: pick up to `maxInternalLinks` targets from this list, only ones genuinely
  related to the article, or none. The parsed output is filtered against the candidate
  set (unknown URLs silently dropped) and capped at `maxInternalLinks`. With no
  candidates or `maxInternalLinks === 0`, the prompt omits internal links entirely and
  the field parses to `[]`.
- **Article step** (`article.ts`): the prompt passes only the surviving selections as
  `title — url` pairs: use exactly these URLs as Markdown links with descriptive
  anchor text; do not add any other links. With no selections: do not include
  hyperlinks.

### 3. Sanitize + validate (fail closed, twice)

New pure module `links.ts` in `@shared/generation`:

- `sanitizeLinks(content, allowedUrls, max)` — walks Markdown inline links, excluding
  images (`![...](...)`), and unwraps to plain anchor text any link whose href is not
  in `allowedUrls`, plus any allowed links beyond the first `max`. Runs in the
  generation pipeline after humanize, before validation (and therefore before the
  video iframe and inline images are injected — neither is affected).
- `validate.ts` gains an `illegal_link` check: any remaining non-image Markdown link
  with an unapproved target, or more than `maxInternalLinks` links, is a validation
  failure. After sanitization this can only fire on a sanitizer bug — it is the
  backstop the acceptance criteria demand, so a bad link can never ship silently.

This enforces "a preset of 1 never yields 4" mechanically, not by prompt hope.

### 4. Cleanup of existing articles

A one-off command in `apps/cli` (`seo-dev db …`): for each org, build the verified
allowed set (same derivation + HTTP check as §1), run `sanitizeLinks` over every
article's `content`, and persist changed articles. In practice all 32 known targets are
dead, so effectively every existing link unwraps to plain text. The command prints
which cleaned articles are currently published so they can be republished through the
existing publish path; it does not publish anything itself.

### 5. Testing

- Unit (`@shared/generation`): `sanitizeLinks` — allowed link kept, unapproved
  unwrapped, over-ceiling unwrapped, image syntax untouched; URL derivation (trailing
  slashes, slug source = `publications[]` not `article.slug`); outline filtering drops
  unknown URLs and caps at N; `illegal_link` validation; outline/article prompt
  content with and without candidates.
- Worker (Vitest, mocked repos + mocked fetch, per existing patterns): org with no
  published articles ⇒ zero links; verification failure ⇒ candidate dropped;
  candidates flow into the prompts.

## Acceptance criteria (from #186)

- No generated article contains `#`, `example.com`, or any URL that does not resolve
  to a known published page.
- An org with no published articles gets zero internal links, whatever
  `internal_links_count` says.
- Placed links point at real, live, verified URLs of the org's own published articles
  and are topically related (LLM-judged at outline time).
- `internal_links_count` acts as a maximum and is enforced mechanically.
- `validate.ts` rejects an article containing an unresolvable link.
- The 24 existing articles are cleaned by the CLI command; the 3 published ones are
  republished.

## Out of scope

- The customer's pre-existing (pre-SeoPotion) pages as link candidates
  (`presets.blog.sitemap_url` scraping) — separate question, separate issue.
- Publish-time re-verification of links (closing the generate→publish gap).
- Embedding-based relatedness.
- Links added manually in the editor after generation.
