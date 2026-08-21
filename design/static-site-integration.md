# Static-Site Integration (git-committed content)

**Status:** contract frozen; **the publisher is built** (2026-07-31) —
[`lib/static-site.ts`](../apps/api/src/lib/static-site.ts) renders these bytes and
`POST /dashboard/articles/{id}/publish` commits them. **Revised 2026-07-30: images are no longer
committed** — they stay on our CDN and articles reference them by absolute URL. The
contract stays `version: 1`; the 2026-08-12 `source_article_id` ownership field is additive,
historical manifests without it still parse, and adapters may ignore it. Extends the integration model in
issue [#7](https://github.com/seopotion/seo/issues/7). Builds on the image pipeline
([`article-images.md`](article-images.md), #51) and the YouTube embed (#85).
First target is a Vue + `vite-ssg` marketing site; the contract is deliberately
framework-neutral. Working notes for that first target live in
`alperNotes/unmarble/initialAudit.md`.

This doc freezes **the content contract** — the bytes we write into a client repo.
Everything else (where integration config is stored, the API surface, the GitHub App)
is named here but designed separately.

## The problem

The only publishing path today is **push into a live server**:
[`clients/wordpress.ts`](../apps/api/src/clients/wordpress.ts) renders Markdown to HTML
and POSTs it to a running WordPress. That works because WordPress is a program with a
database — it can accept a write at any moment.

A static site is a folder of files on a disk. There is no program to push into, and
content only exists if it was there at build time. So publishing means **committing to
the client's git repo** and letting their build run.

## Decisions

| Concern | Choice |
| --- | --- |
| Delivery | **Commit content into the client repo** via the GitHub Git Data API — not a build-time fetch from our API |
| Trigger | The commit itself (`on: push`). `repository_dispatch` is kept only for forced rebuilds with no content change |
| Body format | **Markdown + YAML frontmatter**, one file per article |
| Index | A single **`manifest.json`** so an adapter can enumerate articles without parsing every file |
| Images | **Not committed.** Served from our CloudFront and referenced by absolute URL, exactly as `article.content` already holds them |
| Atomicity | **One commit per publish** (blobs → tree → commit → ref), carrying the Markdown and the updated manifest together |
| Addressing | **Deterministic paths keyed by slug**, so republishing overwrites instead of accumulating |
| Public article URL | **Directory-style and trailing-slash canonical:** `<post_url_base>/<slug>/` |
| Build output | **Nested directory output:** `<route>/index.html`; the host must resolve directory URLs and must not send unknown blog routes to an SPA fallback |
| Auth | **GitHub App** installation token scoped to `contents: write`, per-repo, client-revocable ([`github-app.md`](github-app.md)) |

## Why this shape

**Commit, don't fetch.** The alternative — their build calls our API — was rejected on
one point: a failed fetch breaks their *entire site*, not just the blog. Committing keeps
the **build** self-contained, needs no `SEOPOTION_API_KEY` build secret on their side, and
makes every publish auditable as a `git diff`.

**Images stay on our CDN.** They were originally committed too, on the theory that a
static site should be wholly self-contained. Reversed 2026-07-30: we already run S3 +
CloudFront for the dashboard, `og:image` and the WordPress path, and mirroring those bytes
into a client's permanent git history buys nothing the CDN does not already do — a
regenerated image would leave its predecessor in history forever, and every republish would
push megabytes to move a paragraph.

Be honest about what this trades away, because it is not free:

| | Committed images (rejected) | CDN images (chosen) |
| --- | --- | --- |
| Their site if we vanish | Fully intact | **Every blog image 404s** |
| Image bandwidth | Theirs | **Ours, scaling with their traffic, not their plan** |
| Repo growth | ~24 MB per 50 articles, permanent | Nil — commits are text |
| Publish payload | Markdown + N binaries | Markdown + manifest |
| URL rewriting at publish | Required, and fails the publish when a slot is missing | **Deleted — the body is committed verbatim** |
| Google Images attribution | Their domain | Our CDN domain, until a per-client CNAME |

The first row is the one to weigh: a static site is chosen for independence, and we have
just made ourselves a runtime dependency of every published page. That is defensible while
we are the ones serving it — it is the same bargain every hosted CMS makes — but it turns
our CloudFront distribution into customer-facing infrastructure with a customer-facing
uptime expectation.

**Markdown, not JSON.** Every SSG ecosystem has first-class Markdown tooling (Astro
content collections, Nuxt Content, Next MDX, Vite `?raw` + `marked`, Hugo/Eleventy
natively). A JSON body would force every adapter to hand-roll rendering.

**Absolute URLs, never relative paths.** Resolving a relative image path out of a Markdown
*string* through a bundler's asset pipeline is the single least portable thing we could ask
of an adapter — Astro does it, `marked` cannot. An absolute URL renders identically in every
framework with no asset pipeline involved at all, and costs nothing: we already emit
correctly-sized WebP, so there is no bundler optimization left to want. This was the
argument for root-absolute paths under the committed-images design; it survives the change
unaltered and gets simpler, since the URL in the body is now the one the worker wrote.

## The contract

**One path**, configured per integration.

| Config | Default | Meaning |
| --- | --- | --- |
| `content_path` | `seopotion/` | Where Markdown + manifest go. Never served directly. |

```
<content_path>/
├── manifest.json
└── articles/
    └── <slug>.md
```

That is the entire footprint in a client's repository: text, in one directory, never
touching their static assets or their build config. Nothing lands in `public/`, so the
directory the framework serves from is untouched — which also means the earlier
per-framework variance (`public/` for Astro, `static/` for Nuxt and Hugo) stops mattering.
Images live on our CDN at the S3 keys `article-images.md` already defines.

### Public URL and output contract

Static-site articles use one exact public URL shape. If `post_url_base` is
`https://example.com/blog` and the slug is `article-slug`, the supported URL is:

```
https://example.com/blog/article-slug/
```

The final slash is part of the contract. The adapter must use that exact URL in:

- blog indexes, navigation and every other article link;
- the canonical tag and `og:url`;
- every `BlogPosting` URL that identifies the article and the article item in
  `BreadcrumbList` structured data;
- sitemap entries; and
- internal links between published articles.

The static build must emit `<route>/index.html`, for example
`dist/blog/article-slug/index.html`. Vue sites using `vite-ssg` must set
`ssgOptions.dirStyle: 'nested'` and include `/blog/<slug>/` in `includedRoutes`.
Other frameworks must be configured for the equivalent nested directory output.

### `manifest.json`

The adapter's entry point: enough to build an index page, a sitemap and RSS without
opening a single Markdown file.

```jsonc
{
  "version": 1,
  "generated_at": "2026-07-29T10:15:00.000Z",
  "articles": [
    {
      "source_article_id": "<SeoPotion Article.id>",
      "slug": "ai-outfit-generator",
      "title": "How AI Outfit Generators Work",
      "meta_title": "How AI Outfit Generators Work | Guide",
      "meta_description": "…",
      "keyword": "ai outfit generator",
      "cover": "https://cdn.seopotion.com/orgs/<org>/articles/<id>/cover.webp",
      "cover_alt": "…",
      "cover_width": 1200,
      "cover_height": 630,
      "images": [
        {
          "src": "https://cdn.seopotion.com/orgs/<org>/articles/<id>/inline-1.webp",
          "alt": "…",
          "width": 1200,
          "height": 675
        }
      ],
      "published_at": "2026-07-29T10:15:00.000Z",
      "updated_at": null,
      "path": "seopotion/articles/ai-outfit-generator.md"
    }
  ]
}
```

- `version` is the contract version. **Frozen at `1`.** Adapters should fail loudly on
  an unknown major — that is the whole point of carrying it.
- `articles` is sorted by `published_at` descending, so a naive adapter that renders the
  array in order gets a correct reverse-chronological index for free.
- `source_article_id` is the stable ownership key used by the publisher to reconcile a
  remote commit that landed before Mongo recorded it. Adapters may ignore it.
- `path` is repo-root-relative, so an adapter never has to reconstruct
  `content_path` itself.
- Dates are ISO 8601 UTC strings. `updated_at` is `null` until first edit.
- `cover` and every `images[].src` are **absolute CDN URLs**, byte-identical to what
  `article.content` and `featured_image_url` already hold — no rewriting, in either
  direction.
- `images` repeats the article's inline images — the same list the frontmatter carries,
  emitted from one function so the two cannot disagree. It is here so an adapter can fix
  inline CLS **without parsing YAML**; see § Body rules 4 for why the sizes are needed at
  all. Decided 2026-07-31, while the contract was still unshipped and free: putting it off
  until the encoder records dimensions would have meant a `version: 2` and every adapter in
  the wild breaking, for a field that costs nothing to carry now.
- `cover_width` / `cover_height` are the stored object's actual pixels, as the image
  provider reported them
  ([`article-images.md`](article-images.md#recorded-dimensions)) so the `<img>` can
  reserve its space and not shift the layout. **Both may be `null`** on articles
  generated before dimensions were recorded — omit the attributes rather than guess.
  These matter more now than they did: a cross-origin image gives the browser no local
  file to measure, so without them the layout shifts on every article, on a page whose
  reason for existing is a Core Web Vitals score.

### Article frontmatter

YAML, because Astro, Nuxt and Hugo all parse it natively.

```yaml
---
source_article_id: "<SeoPotion Article.id>"
slug: ai-outfit-generator
title: How AI Outfit Generators Work
meta_title: How AI Outfit Generators Work | Guide
meta_description: "…"
keyword: ai outfit generator
published_at: "2026-07-29T10:15:00.000Z"
updated_at: null
cover: https://cdn.seopotion.com/orgs/<org>/articles/<id>/cover.webp
cover_alt: "…"
cover_width: 1200
cover_height: 630
images:
  - src: https://cdn.seopotion.com/orgs/<org>/articles/<id>/inline-1.webp
    alt: "…"
    width: 1200
    height: 675
video:
  id: dQw4w9WgXcQ
  title: "…"
---
```

Fields map 1:1 onto [`ArticleSchema`](../packages/shared/schemas/src/article.ts):
`title` is the H1, `meta_title` is the SERP `<title>` (they differ), `cover` is
`featured_image_url` verbatim. `video` is `null` when absent.

Timestamps are **quoted** so YAML parsers hand back strings rather than each coercing to
its own date type.

### Body rules an adapter must honour

1. **The body contains raw HTML.** The YouTube embed is injected as an `<iframe>` block
   ([`generation/src/video.ts`](../packages/shared/generation/src/video.ts)), so the
   Markdown renderer must have HTML passthrough enabled. A renderer that escapes HTML
   will print iframe source at the reader.
2. **The body starts at `##`.** The H1 is `title` in frontmatter and is the page's
   responsibility to render — the body never contains one, so heading levels stay valid.
3. **Inline images are already in the body** as `![alt](https://cdn…/inline-1.webp)`,
   injected after their target `## heading` by the images worker. We commit the body
   byte-for-byte as stored. The cover is *not* in the body; it is frontmatter only, for
   the page header and `og:image`.
4. **Markdown image syntax carries no dimensions**, so a plain render emits `<img>` with
   no `width`/`height` and the body still shifts as images load. That is why each
   `images[]` entry repeats its `src` alongside `width`/`height`: an adapter that cares
   about CLS matches on `src` in a renderer hook and adds the attributes. The list is in
   **both** the frontmatter and the manifest, so this works whichever one the adapter
   reads. The cover is frontmatter- and manifest-level, so it needs no lookup at all.
   Sizes are `null` until the encoder records them — leave those `<img>`s alone rather
   than guessing.

### What the client site owns

We supply data; the site renders it. An adapter is expected to emit, per article:
a canonical URL and `og:url` in the exact trailing-slash form above, other `og:*` tags
from `meta_title` / `meta_description` / `cover`, `BlogPosting` + `BreadcrumbList`
JSON-LD with the same article URL, and sitemap entries with that URL. Those are page
concerns that depend on the site's own routing, so the contract specifies their URL
shape but does not render them.

### Hosting contract

The host must resolve a directory URL such as `/blog/article-slug/` to
`/blog/article-slug/index.html`. A successful Git commit proves only that the source files
landed, and a successful static build proves only that the output files were generated.
Neither proves that the production host routes the public URL to those bytes. That routing
is deployment configuration and must be checked on the deployed host; it is not a reason
to add live-site polling or request-time fetching to the publishing flow.

A request for an existing article without the slash, such as `/blog/article-slug`, may
redirect to `/blog/article-slug/`; it must never fall through to the homepage. Only the
trailing-slash form is linked, canonicalized or indexed.

A site-wide SPA fallback such as `try_files ... /index.html` is dangerous for article
routes: a missing `/blog/article-slug/` or an unknown `/blog/anything/` can return the
homepage with HTTP 200. Search engines then see a soft 404 and the integration can appear
healthy while serving the wrong document. Unknown blog paths must return a genuine HTTP
404 or 410.

For nginx, scope the blog before any broader SPA fallback and enable directory indexes:

```nginx
index index.html;

location ^~ /blog/ {
  try_files $uri $uri/ =404;
}
```

Equivalent hosts must preserve the same behavior: resolve existing directories to their
`index.html`, and do not rewrite missing blog routes to the homepage.

## Publish semantics

**Gate.** Same as WordPress: reject unless `article.images_status === 'complete'`
([`dashboard.ts:616`](../apps/api/src/routes/dashboard.ts#L616)). The gate survives the
move to CDN images unchanged — an article published mid-generation would ship `<img>` tags
pointing at objects that do not exist yet, which is worse than a missing local file because
the page looks fine in the diff and breaks in the browser.

**No URL rewriting.** `article.content` already holds absolute CloudFront URLs, injected by
the images worker at generation time ([`worker/src/images.ts`](../apps/worker/src/images.ts)),
and those are exactly the URLs we want in the committed file. The body is copied verbatim.
This deletes the most failure-prone step in the original design — a per-slot exact string
replacement that had to abort the publish whenever a slot's URL was missing from the body.

**One commit per publish.** `POST /git/blobs` per file → `POST /git/trees` →
`POST /git/commits` → `PATCH /git/refs/heads/<branch>`. Never `PUT /contents/{path}`
per file — that is N commits, N builds, and a race between them. Two text blobs now
(the Markdown and the updated `manifest.json`), so the manifest can never reference a file
that is not there.

**Concurrency.** The shared static-site publisher used by the manual route and automatic
worker atomically claims an expiring lease on the static-site Integration. The lease spans
the complete read → validate → Git commit → `recordPublication()` sequence, so our own
publishes cannot both make semantic decisions from the same manifest. Active contention is
transient; a crashed owner can be replaced after the lease expires.

The Git ref remains a second concurrency boundary because a human or another GitHub client
can still move the branch. `commitFiles()` reads the current head, then invokes semantic
preparation for that exact commit. A non-fast-forward ref update restarts the whole
preparation callback: it rereads the new head's manifest, reloads database publications,
revalidates slug ownership, and rerenders. It never layers stale prepared files onto a new
tree.

**The manifest is rebuilt from remote and local state.** Each manifest entry carries
`source_article_id`. Preparation starts with the remote head's entries and reconciles every
locally recorded publication onto them before adding the current article. This deliberately
preserves a remote entry whose Git commit succeeded before its local publication write: a
later article cannot remove it or claim its slug, and the original retry can reconcile the
already-landed tree without another commit. A normal automatic first publication uses its
stable `requested_at` as `published_at` and stores `updated_at: null`; attempt time is not an
edit timestamp. Recovery reconstructs the source-owned remote entry's exact `published_at`
and nullable `updated_at`, then compares the complete desired manifest entry and Markdown
bytes. An exact recovery retains both timestamps and the remote manifest's existing
`generated_at`, so the desired tree stays byte-identical even after complete request loss.
If current content differs after an orphaned first commit, the publisher keeps the remote
original `published_at` and uses a newer durable `article.updated_at` for `updated_at`. When
no newer durable edit timestamp exists, it deterministically reuses the remote version time
as an explicit non-null update marker. Mongo records this exact timestamp pair; equality is
never interpreted as proof that no update occurred. Each ref-retry preparation derives these
decisions again from the exact head it is extending.

Lease release matches the owning token and is best-effort after the primary operation. A
Mongo cleanup outage therefore cannot turn an already recorded success into an API failure
or replace a specific publishing error; the lease expiry remains crash recovery.

**Republish** overwrites in place — same slug, same path, manifest entry updated with a
new `updated_at`; `published_at` keeps meaning "first went live". A slug **renamed** since
the last publish deletes the old file in the same commit, which is what
`publications[].slug` exists to make possible: the repo is never briefly serving both.

**Unpublish is not wired.** `status: 'deleted'` drops an article out of the manifest
(`listPublishedTo` filters it), but nothing sets that status today and no route deletes the
Markdown, so a hypothetical unpublish leaves an orphaned — and unreferenced — file behind.
Worth closing when article deletion is actually built. The CDN objects are *not* deleted
either way: they are still referenced by the dashboard preview, `og:image` and any
WordPress copy of the same article, so their lifecycle belongs to the article, not to any
one publication.

**Slug collisions: publishing rejects them.** There is no unique index on `articles.slug`
([`ensure-indexes.ts`](../packages/shared/db/src/ensure-indexes.ts) indexes `org_id` +
`created_at` / `status` only), so under a filename-addressed contract the second article to
claim a slug would silently overwrite the first. **Resolved 2026-07-31 by rejecting at the
publish operation** (`409 slug_conflict`) when another local or remote manifest entry is
owned by a different source article. The check runs under the provider lease and reruns for
every Git head after a ref conflict. The alternative, a unique index on `{ org_id, slug }`, was not taken:
it can fail to build on existing duplicate data, and it would move the failure to the
editor's slug field, where a collision with an article the user cannot see is a confusing
500. The cost of rejecting instead is that the collision surfaces at publish time rather
than at rename time.

## Per-framework adapters

The deliverable per framework is a documented snippet, not a package — roughly 30 lines.

| Framework | Route enumeration hook |
| --- | --- |
| **Vue + `vite-ssg`** | `ssgOptions.dirStyle: 'nested'`; `includedRoutes` reads `manifest.json` → `/blog/<slug>/` per article. **Written 2026-07-31** — see below |
| Next.js (static export) | `generateStaticParams()` |
| Astro | `getStaticPaths()`, or point a content collection at `content_path` |
| Nuxt | `nitro.prerender.routes` |
| Hugo / Eleventy | Native content directory — near-zero adapter |

### What the first adapter turned out to need

Written against unmarble (Vue 3 + `vite-ssg` 28) and verified end-to-end against bytes
emitted by the real renderers above. Two files, ~90 lines of adapter and ~10 of build
plugin, and the following worth carrying to the next framework:

**No YAML parser, in either half.** The frontmatter duplicates the manifest exactly, so
the adapter reads metadata from `manifest.json` and slices each Markdown file at its
closing `---`, keeping only the body. That was not an accident of this framework — it
falls out of the manifest carrying every frontmatter field, and it means no adapter needs
a YAML dependency to render an article correctly. Writing this adapter is what surfaced the
one field that *wasn't* in the manifest — `images[].width`/`height` — and **it was added on
2026-07-31 rather than deferred**: the values are all `null` until the encoder records
dimensions, but the contract is unshipped today and would have needed a `version: 2`
later, so carrying an empty field now is strictly cheaper than adding a real one after
adapters exist. The Vue adapter matches on `src` and injects the attributes at build time,
skipping any image whose size is still `null` — so it starts preventing layout shift on
its own the day the encoder lands, with no further change.

**Compile Markdown at build time, not in the browser.** A ~10-line Vite plugin turns each
committed `.md` into a module exporting its rendered HTML, so the Markdown renderer is a
devDependency and each article is its own lazy chunk. The obvious alternative — ship the
raw Markdown and a parser — puts every article in the client bundle of a site whose entire
purpose is a Core Web Vitals score.

**Load the body in a routing hook, not in the component.** vite-ssg awaits
`router.isReady()` both when prerendering and before hydrating, so an async `beforeEnter`
is awaited on both sides and the two renders match with no `<Suspense>` and no state
transfer. The equivalent question in another framework is "what does the prerenderer
await?" — answer that first. The cost is one small chunk fetch after paint on the first
load; inlining it as hydration state would put the article HTML in the page twice, which
is worse on the metric the page exists for.

**Keep the manifest out of the shared bundle — and measure, don't assume.** The obvious
wiring puts it there twice: the router holds the route guards and is in every page's
bundle, and a "show the blog link only when there is a blog" footer reads the article list
to decide. Measured cost on the first cut: **~860 bytes per article on every page**,
homepage included, growing with the blog — on a site whose reason for existing is a Core
Web Vitals score. The fixes are per-framework (here: import the content module *inside*
the guard, and inject a build-time boolean for the footer) but the trap is not — any
framework where routing is eager will have some version of it, and it is invisible until
you diff the chunk sizes.

**Structured data is the site's job, and v1 already carries everything it takes.** The
adapter renders `BlogPosting` + `BreadcrumbList` JSON-LD entirely from manifest fields —
`title`, `meta_description`, `cover`, `published_at`, `updated_at` — so the contract needed
no addition for it. Two things are the *site's* to supply and deliberately not ours:
`author`/`publisher`, which are the client's own organization node (SeoPotion articles have
no bylined human, and inventing one is a manual-action risk), and the breadcrumb trail,
which is their URL hierarchy. Worth saying to the next adapter author because the instinct
is to ask us for an `author` field; the right answer is that we don't know who it is and
shouldn't guess.

**Don't prerender an empty index.** Before the first publish there is no `seopotion/`
directory at all, and both halves have to treat that as normal rather than as an error —
the client's site must build and deploy exactly as it did before they connected us. A
`/blog` index prerendered with nothing in it is a thin, unlinked URL in their sitemap, so
the route is emitted only once an article exists, and the nav link to it is hidden on the
same condition.

**A version mismatch must not take the site down.** The contract says adapters fail loudly
on an unknown major, and the tempting reading is "throw". But in every prerendered
framework the blog is built by the same command as the homepage, so throwing means *we*
can break a client's entire deploy by publishing. The adapter logs loudly and renders no
blog: their site stays up, their articles go dark until the adapter is updated.

## Work this implies

**SeoPotion side.** Each is its own issue; none is designed here.

1. **WebP + resize in the images worker.** *Designed:
   [`article-images.md` § Encoding](article-images.md#encoding-webp--downscale); being built
   system-wide, not on this track.* Not a **gate** on this integration — nothing here
   touches image bytes, so 2–5 below can be built and tested against the PNGs we store
   today. It is still required before a client site goes live: those images now load
   cross-origin on someone else's pages, so a 2 MB PNG cover is their Largest Contentful
   Paint, on a page we sold as an SEO asset.
2. ~~**`apps/api/src/clients/github.ts`**~~ — **built 2026-07-30**
   ([`clients/github.ts`](../apps/api/src/clients/github.ts)): App JWT via `node:crypto`,
   installation tokens scoped to one repo at mint time and cached at module scope, and
   `commitFiles()` — blobs → tree → commit → ref, with a re-read-and-rebuild retry on a
   non-fast-forward. Deletions travel in the same commit as writes (a `null` content is a
   `null` tree sha), which is what makes the slug-rename cleanup below a single publish.
   Rendering frontmatter and rebuilding `manifest.json` is the publish route's job (4), not
   the client's.
3. **Generalise the integration model (#7).** Integration state is hardcoded to
   WordPress today: `org.wordpress_token`, `org.wordpress_connected_at`, and
   `/integrations/connected` returns a **literal** `'wordpress'`
   ([`dashboard.ts:394-398`](../apps/api/src/routes/dashboard.ts#L394-L398)).
   *Designed: [`integrations-model.md`](integrations-model.md). An `integrations`
   collection holds one document per (org, provider); the `static-site` member carries
   the installation id, repo, branch and `content_path`. It also adds
   `article.publications[]`, which records the slug we last committed under — the
   editor can rename a slug, and this contract addresses every file by it.*
4. ~~**`POST /articles/{id}/publish`** for the git target~~ — **built 2026-07-31**
   ([`dashboard.ts`](../apps/api/src/routes/dashboard.ts), next to
   `/articles/{id}/wordpress`, whose gates and 404-don't-leak rule it copies). Rendering
   lives in [`lib/static-site.ts`](../apps/api/src/lib/static-site.ts) as pure functions —
   no I/O, so the exact committed bytes are asserted in tests rather than round-tripped.
   Every YAML scalar is emitted with `JSON.stringify`, because JSON is a subset of YAML
   1.2's double-quoted style: a correct escape for colons, quotes and newlines with no
   dependency and no hand-rolled escaper. Quoting *everything* also dodges YAML 1.1's
   `no` → `false`, which a slug can genuinely be.

**Client side (per site).** Blog index + detail routes, the adapter snippet, blog entries
in the sitemap, and host routing that serves nested directory indexes without applying the
homepage fallback to unknown blog paths. Deploying on push is a prerequisite we *assume*
rather than build — Vercel, Netlify, Cloudflare Pages and Coolify all do it out of the box,
and a client without it needs a one-off workflow that is not part of this contract. A green
build still does not prove the host routing contract. *Built for the first site 2026-07-31
(unmarble, branch `alper/seo-improvements`); the sitemap entries cost nothing there because
its generator already walks the build output.*

## Deliberately out of scope

- **Which secret store holds the GitHub App private key**, and the installation flow.
  *Now designed: [`github-app.md`](github-app.md) — an SSM SecureString read by the API
  Lambda only, and a state/grant-guarded install flow. The WordPress precedent (a plaintext
  `WORDPRESS_ROUTE_SECRET` literal in [`config.ts:17`](../apps/api/src/config.ts#L17),
  shared across every install) is explicitly not repeated.*
- **Non-GitHub hosts.** GitLab and Bitbucket have equivalent tree APIs; the *contract*
  above is host-neutral and only the client module would change. No abstraction until
  there is a second host asking for one.
- **Preview / draft publishing.** Would need a second branch and a preview URL per
  article — real, but not part of the first cut.

## Open decisions from hosting the images

Both follow from the 2026-07-30 reversal and neither blocks building this:

- ~~**What happens to a departing client's images.**~~ **Not this track's, decided
  2026-07-31.** Their published pages reference our CDN by absolute URL, so cancelling
  either leaves us serving their traffic indefinitely or breaks every image on a live site
  the day they leave — but that is an image-lifecycle question, and image lifecycle is
  owned by the backend developer alongside the encoding work in
  [`article-images.md`](article-images.md). Recorded here only because this contract is
  what makes those URLs load-bearing. For whoever picks it up: the cheap answer is an
  **export on cancel** — commit the WebP into their repo and rewrite the URLs, which is
  precisely the code the 2026-07-30 revision removed, so reviving it is a known quantity
  rather than a new design.
- **Image SEO attributes to our domain.** Google Images indexes by URL, so image results
  for a client's article point at `cdn.seopotion.com`. Every hosted CMS has this and it is
  not disqualifying, but we are selling SEO. The standard fix is a per-client CNAME
  (`images.theirdomain.com` → our distribution), which also makes the export question
  smaller. Worth pricing as an upgrade rather than building now.
