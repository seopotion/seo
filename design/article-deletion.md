# Article deletion and unpublish

Backend [#183](https://github.com/seopotion/seo/issues/183), frontend
[#184](https://github.com/seopotion/seo/issues/184).

`'deleted'` has been in `ARTICLE_STATUSES` since the beginning and nothing has ever
written it. `listPublishedTo` filters on it, the admin panel styles it, Content History
renders a badge for it, `ArticleEditorPanel` has a branch for it — all reachable only if
something sets it. This is the design for the thing that sets it.

The concrete failure that forced it: an article published to a customer's GitHub repo
carried image URLs into the pre-migration CloudFront distribution, which no longer
resolves. Their Astro build fails on every deploy, and we have no lever to pull the file
back out of their repository.

## The three questions #183 asks, answered

**Is delete the same operation as unpublish?** No — two operations, one destructive UI
path. `POST /articles/{id}/unpublish` withdraws from every provider the article went live
on and leaves a `generated` article behind. `DELETE /articles/{id}` refuses while any
publication remains. The frontend presents deleting a published article as one confirmed
action that runs both.

The alternative — one `DELETE` that silently commits into a customer's repo on its way
through — hides a git write behind a verb that reads local. Keeping them separate also
makes unpublish independently useful (retract, fix, republish) and makes the intermediate
state after a partial failure a *safe* one: off the live site, still in the dashboard.

**Is either reversible?** Unpublish is: republish puts it back, with `published_at`
preserved (`publications[]` is rebuilt, `article.published_at` is stamped once and never
moved). Delete is reversible in the database only — it is a soft delete, no UI un-deletes
it. The customer's site is not reversible from our side at all: once their build runs the
page 404s, and anything Google indexed 404s with it.

**What happens to `publications[]`?** Unpublish removes the withdrawn provider's entry.
When the array empties, `status` goes back to `'generated'` and `published_at` back to
`null` — the article has never been anywhere. Delete then sets `status: 'deleted'` and
touches nothing else.

## Data model

Soft delete. `status: 'deleted'`, document retained. Hard deletion would orphan
`keyword.article_id`, the analytics page-match in `analytics.ts`, and the `admin_actions`
audit trail, and the schema was clearly built for the soft version.

Consequences, all of which are already the case for `listPublishedTo`:

| Surface | Treatment |
| --- | --- |
| `ArticleRepo.listByOrg` | Excludes `deleted` unless the caller asks for it |
| Dashboard article list / counts | Deleted articles gone, not badged |
| Admin panel | Still lists them, badge already styled (`apps/admin/src/lib/status.ts`) |
| Static-site manifest | Already filtered — `listPublishedTo` has the `$ne: 'deleted'` clause |
| Slug reclaim | Free once `publications[]` empties; the publish route's conflict scan reads the rebuilt manifest, so nothing extra is needed |
| `keyword.article_id` | **Left pointing at the deleted article** (decided). Nulling it would let the daily scheduler regenerate the same keyword tomorrow, which is the opposite of what deleting means. Regeneration is a separate feature |
| CDN image objects | Not deleted, per `design/article-images.md` — their lifecycle belongs to the article, and the dashboard preview still renders them |

## Backend

### `@shared/db` — `ArticleRepo`

```ts
/** Remove one provider's publication. Returns the remaining count. */
async removePublication(id: string, provider: IntegrationProvider): Promise<number>
```

`$pull` the entry; in the same round, if `publications` is now empty, `$set` `status:
'generated'`, `published_at: null`. Two writes (the driver can't express "set only if the
pull emptied it" in one), the second guarded on `publications: { $size: 0 }` and
`status: 'published'` so a concurrent republish can't be clobbered.

```ts
/** Soft delete. Refuses while any publication remains. Returns false if it did nothing. */
async softDelete(id: string): Promise<boolean>
```

Filter `{ _id, publications: { $size: 0 }, status: { $ne: 'deleted' } }`, set `status:
'deleted'`. The filter is the atomic guard behind the route's 409 — the route's own check
is the friendly error, this is the one that's actually correct under concurrency.

`listByOrg` gains `includeDeleted?: boolean` (default `false`) and appends
`status: { $ne: 'deleted' }` when it's absent and no explicit `status` was passed. Callers
that must keep seeing everything: `apps/api/src/admin/routes/articles.ts:83`, and the CLI's
`clean-links` / `reset-images` sweeps. Everything else wants the new default.

### `apps/api/src/lib/publishers.ts` — `unpublishStaticSiteArticle`

Mirrors `publishStaticSiteArticle` (same file, ~line 267) closely enough that it should be
read side by side with it.

1. **Claim the publish lease** — `IntegrationRepo.claimPublishLease(org_id, 'static-site',
   token, now, STATIC_PUBLISH_LEASE_MS)`, same 409 `static_publish_in_progress` on
   contention, same best-effort release in `finally`. Not optional: without it a concurrent
   publish rebuilds the manifest from a snapshot that still contains this article.
2. **One `commitFiles` call** with a `prepare` callback:
   - read + `parseManifest` the remote manifest (absent ⇒ nothing to withdraw, see 5)
   - rebuild entries from `ArticleRepo.listPublishedTo(org_id, 'static-site')` exactly as
     publish does, so concurrent drift reconciles instead of being overwritten
   - drop the entry this article owns: `source_article_id === article.id`, or the legacy
     `source_article_id === null && entry.slug === publication.slug`
   - files: the rewritten manifest, plus `{ path: articlePath(content_path,
     publication.slug), content: null }` — **only when `readFile(path) !== null`**. The
     tree API rejects a delete of a path that isn't in the tree, and this is what keeps a
     retry after a half-succeeded commit from failing.
   - commit message `seopotion: unpublish "<title>"`
3. **Idempotent by construction** — `commitFiles` returns the existing head sha when the
   tree is unchanged ([github.ts:404](../apps/api/src/clients/github.ts#L404)), so a
   second unpublish is a no-op that still reports success.
4. **Then** `ArticleRepo.removePublication(article.id, 'static-site')`. Commit first,
   record second — the same order as publish, for the same reason.
5. Manifest absent, or no entry owned by this article, or `publications[]` has no
   static-site entry: still remove the local publication and return success. The goal
   state is "not published", and it is already true.

Uses `publishingFailure` / `PublishingFailure` throughout so the route's existing
409/422/500/502 mapping applies unchanged.

### `apps/api/src/clients/wordpress.ts` — `deleteWordPressArticle`

The blocker: WordPress publishing does not use the WP core REST API, it uses **our own
plugin** at `/wp-json/seo-potion/v1/{submit,edit}`. There is no delete route to call.

```ts
export function deleteWordPressArticle(
  websiteUrl: string, token: string, postId: number,
): Promise<WordPressArticleResult>
```

`POST /wp-json/seo-potion/v1/delete`, same `X-Secret-Key` header and `secret` body field as
the others, body `{ secret, id }`.

Gated on capability, reusing the `getWordPressCapabilities` + version-floor pattern already
written for `idempotent_publish`
([publishers.ts:115](../apps/api/src/lib/publishers.ts#L115)): requires `'delete'` in
capabilities and plugin ≥ 1.3.0, else `plugin_upgrade_required` (permanent, 422). Customers
on an older plugin get told to upgrade or trash the post themselves — there is no way
around that and the UI must say it plainly.

### `apps/integration-clients/wordpress-org` — plugin v1.3.0

- `register_rest_route('seo-potion/v1', '/delete', ...)` with the same
  `hash_equals(SEO_POTION_API_SECRET, ...)` permission callback as `/submit` and `/edit`.
- Resolve the post by `id`, falling back to `source_article_id` via the existing
  `seo_potion_find_post_by_source_article_id`.
- **`wp_trash_post`, not `wp_delete_post`.** The post leaves the site and the customer can
  restore it from their own trash. We do not permanently destroy content in someone else's
  CMS.
- Remove the row from the `{prefix}outrank_manage` tracking table.
- Already gone ⇒ 200, so a retry is idempotent.
- Add `'delete'` to `seo_potion_get_capabilities`; bump `Version:` in `seo-potion.php` to
  `1.3.0`.

Note that this plugin ships to customers out of band. The backend must work correctly
against both old and new plugins from day one, which the capability gate is what delivers.

### Routes — `apps/api/src/routes/dashboard.ts`

```
POST   /dashboard/articles/{id}/unpublish
DELETE /dashboard/articles/{id}
```

Both `OpenAPIHono<AuthEnv>`, `security: [{ Bearer: [] }]`, `middleware: [authMiddleware]`,
ownership through the existing `loadOwnedOrg(article.org_id, userId)` → 404 on miss (never
403; a non-owner learns nothing).

**Unpublish** iterates `article.publications` and calls the right withdrawer per provider,
collecting results rather than failing on the first one:

```jsonc
// 200
{ "results": [
    { "provider": "static-site", "status": "withdrawn", "commit_sha": "…" },
    { "provider": "wordpress",   "status": "failed",
      "code": "plugin_upgrade_required",
      "message": "The WordPress plugin must be upgraded before…" }
  ],
  "remaining_publications": 1 }
```

200 with per-provider results, not a multi-status: partial withdrawal is a real outcome
(static site retracted, WordPress plugin too old) and the UI has to render both halves.
No publications at all ⇒ 200 with an empty `results`.

**Delete** → 204 on success. 409 `{ code: 'still_published' }` when `publications[]` is
non-empty, with the provider list in the body so the UI can name them. 404 unknown/not
owned. Idempotent: deleting an already-deleted article is 204.

Both write `admin_actions`-style audit entries only if the dashboard already does so for
comparable actions — check before adding; do not invent a new audit surface.

## Frontend — `apps/web`

Wiring, mostly. The `'deleted'` branches already exist; the work is making them reachable
and building one confirmation dialog that tells the truth.

**One entry point, and only one: the Content History article editor** —
`app/[locale]/(authenticated)/(product)/content-history/[articleId]/page.tsx` (1215 lines;
the publish actions around lines 260–410 are the model to follow). A delete action,
visually subordinate to publish — not a primary button. It opens the dialog below; on
success, route back to Content History.

The delete action goes **in that page, not in `components/article/ArticleEditorPanel.tsx`**.
The panel is shared: the Content Planner's `ArticleEditorModal` renders the same component
([ArticleEditorModal.tsx:108](../apps/web/app/[locale]/(authenticated)/(product)/content-planner/_components/ArticleEditorModal.tsx#L108)),
so a button added inside it appears in the planner too. Deleting is not a planner action.
No delete control in list rows, no row-level menu, nowhere else.

**The dialog** is the part that carries the issue's real requirement. Three variants, by
what the article actually is:

| Article | Copy |
| --- | --- |
| Never published | Routine. "Delete this article? This can't be undone." |
| Published to a static site | Names the repo and the branch, and says the page will 404 on their site once it rebuilds, and that anything Google indexed will 404 too. Requires a deliberate confirm — not a button that can be hit by muscle memory |
| Published to WordPress | Says the post moves to the site's trash, restorable from WordPress |

Two providers ⇒ both consequences listed. The dialog runs unpublish then delete, showing
which step it's on, and on partial failure it stops, keeps the article, and reports which
provider refused and why (`plugin_upgrade_required` needs its own translated string with an
instruction, not a raw code).

**Content History list** — `content-history/page.tsx:97-103` deliberately fetches
unfiltered; with deleted articles now excluded server-side that comment needs updating, and
`StatusBadge` (line 369) keeps its `'deleted'` arm for the admin-visible case. No delete
control here — the list only has to stop showing what the editor deleted, which it does by
refetching when the user routes back to it.

**Content Planner editor modal** — no new control, but
`components/article/ArticleEditorPanel.tsx:435` already branches on `'deleted'`. Verify it
renders sensibly now that the status is reachable, and that the panel offers neither edit
nor publish on a deleted article.

**i18n** — `apps/web/messages/en.json` and `tr.json`, both, in the same commit. Every
consequence string above, plus the per-provider failure codes.

## Work packages

Sized to be built and reviewed independently. 1 and 2 have no dependency on each other.

1. **Data layer** — `removePublication`, `softDelete`, `listByOrg` default change + caller
   audit. Unit tests against the repo. Small and self-contained.
2. **WordPress plugin v1.3.0** — the `/delete` route, capability, version bump. PHP only,
   touches nothing TypeScript.
3. **Static-site unpublish** — `unpublishStaticSiteArticle`. The one with real subtlety
   (lease, manifest rebuild, conditional file delete, idempotent retry). Depends on 1.
4. **WordPress unpublish** — client function + capability gate. Depends on 1, and on 2 for
   an end-to-end test.
5. **Routes** — both endpoints, schemas in `apps/api/src/schemas/dashboard.ts`, route tests
   via `testClient<AppType>`. Depends on 3 and 4.
6. **Frontend** — detail-page action, dialog, list handling, editor-panel check, both
   locale files. Depends on 5 for the typed client to compile.

Verification gate for every package: `npm run lint`, `npm run check:all`, `npm test`.
Package 3 additionally wants a manual run against a scratch repo before it goes near a
customer's — the failure mode is a bad commit in someone else's git history.

## Deliberately not in scope

- Un-deleting from the UI. Soft delete makes recovery possible by hand; a restore flow is
  a separate feature nobody has asked for.
- Deleting the CDN image objects — see the table above.
- Bulk delete.
- Admin-panel delete. The admin panel styles the status already; giving staff a delete
  button is its own decision.
