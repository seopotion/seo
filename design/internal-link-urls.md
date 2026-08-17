# Internal-link URL derivation (#228)

How we decide the live URL of one of our own published articles, so #186's
internal-linking system has candidates that actually verify.

## The bug this replaces

`publishedArticleUrl(mainBlogUrl, slug)` built `presets.blog.main_blog_url +
'/' + slug`, treating the blog **index** URL as a **post prefix**. Those are
different facts. `main_blog_url` is hardcoded to `${origin}/blog` at setup and
labelled "Blog page URL" in onboarding — nothing ever claimed it prefixes
posts. Sites that serve posts at the root (Clewas: index at `/blog`, posts at
`/`) got a wrong URL for every article, every candidate 404'd at verification,
and every article shipped with zero internal links — silently, because #186
fails closed and "verified nothing" is indistinguishable from "published
nothing".

## The decision

**Where posts appear on a site is decided by the publishing provider — asked
for or recorded, never inferred.** `deriveCandidates` resolves the most recent
`publications` entry per article, provider-shaped:

- **WordPress** — the publish API returns the real permalink and we already
  store it in `publications[].remote_url`. That value is the candidate URL.
  Nothing is asked, nothing is joined.
- **Static-site** — only the customer knows their routing (it's their build).
  The connect form collects `post_url_base` (stored on the integration record
  next to `content_path`); candidate URL = base + published slug. Connections
  that predate the field have `null` — no base, no candidates from this
  provider, and `db set-post-base --org <id> --base <url>` backfills it
  without redoing the GitHub App flow.

`main_blog_url` keeps its onboarding/display role but is no longer
load-bearing anywhere.

### Trust boundary (revises #186's doctrine)

#186 originally refused to ask providers what URL they created. That is
relaxed: providers may **claim** a URL, but a claim never places a link — HTTP
verification (`link-verify.ts`) remains the only gate. A wrong permalink, a
wrong user-entered base, a stale record: all produce **zero** links, never
dead ones.

### Rejected: deriving the prefix from the sitemap

Matching published slugs against sitemap `<loc>` entries at generation time
was considered and rejected: it is still inference, with more moving parts
(site reachable, sitemap fresh, slug matching, apex/`www` normalization) and a
network call per generation run. Asking the one party that knows is more
honest than observing harder.

## Fail-closed matrix

| State | Result |
| --- | --- |
| WordPress publication, `remote_url` null or not http(s) | dropped |
| static-site connection, `post_url_base` null | dropped + warning |
| wrong user-entered base | 404 at verification → zero links + warning |
| article has no `publications` entry | dropped (no provider to ask) |
| org published nothing | zero links, no warning — legitimate |

The warning is the generation worker's `internal links: published articles
yielded no usable candidates` (`{published, derived, verified}`) — the one
signal that separates "this org published nothing" from "we failed to place a
single link for an org that did publish", whose absence is what let #228 hide.
`db clean-links` reports `published` next to `allowedUrls` for the same
reason.
