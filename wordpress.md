# SEO Potion WordPress integration audit

Audit date: 2026-07-13

> **Current work starts at [Implementation handoff — 2026-07-14](#implementation-handoff--2026-07-14).**
> Treat that section and its TODO lists as the current source of truth. The audit through
> "Verification limitations" is historical context for the unmodified Outrank 1.0.10 import.

## Scope and baseline

This historical section describes the unmodified Outrank WordPress plugin version 1.0.10 that was
imported at `apps/integration-clients/wordpress-org`. It records the original baseline and contains
no current task instructions. Use the dated implementation handoff and TODO lists below when
changing the SEO Potion fork.

The intended SEO Potion boundary is a thin adapter for self-hosted WordPress. SEO Potion already
owns article generation, editing, planning, billing, publication policy, and article assets. The
plugin receives a materialized article, translates it into native WordPress operations, and reports
the resulting WordPress state.

The imported tree was confirmed as byte-for-byte Outrank 1.0.10 from WordPress.org at the start of
the audit.

## Existing architecture

- `outrank.php` is the plugin bootstrap. It installs the custom table, registers admin pages and
  assets, handles multisite lifecycle hooks, and mirrors local status/deletion changes.
- `libs/api.php` contains the REST routes and nearly all publication behavior.
- `includes/image-functions.php` downloads remote images and inserts Media Library attachments.
- `pages/home.php` renders a local article dashboard backed by the custom table.
- `pages/manage.php` stores the site API key and a global publish-versus-draft preference.
- The custom `{prefix}outrank_manage` table stores image ID, slug, title, meta description, status,
  and creation time. Its unique identity is the mutable slug. It does not store the WordPress post
  ID or a SaaS article ID.

### Existing REST surface

- `POST /outrank/v1/submit` creates an article.
- `PUT /outrank/v1/edit` updates an article selected by WordPress post ID or current slug.
- `POST /outrank/v1/test-integration` is an unsigned mutating integration test.
- `GET /outrank/v1/posts` is an unsigned broad post-listing endpoint.
- `POST /outrank/v1/set-integration-id` stores an integration identifier after checking the site
  API key carried in the body.
- `GET /outrank/v1/capabilities` is unsigned and reports a small static capability list.

## Existing publishing flow

The create flow is:

1. Check the global route secret and the site API key from the request body.
2. Read the fully materialized article fields supplied by the SaaS.
3. Sanitize the title, requested slug, content, taxonomy values, author, and SEO fields.
4. Download the featured image when an image URL is present.
5. Resolve categories and tags.
6. Generate a slug that is unique across the custom table and WordPress posts.
7. Create a native WordPress `post` as either draft or published according to one global plugin
   setting.
8. Insert a slug-keyed row into the custom tracking table.
9. Assign the featured image and update attachment ownership.
10. Write compatibility metadata for third-party SEO plugins.
11. Return a simple success response containing the WordPress post ID.

The edit flow is:

1. Check the global route secret and the site API key from the request body.
2. Locate a WordPress post using a caller-supplied WordPress ID or current slug.
3. Apply any supplied title, content, slug, status, author, category, tags, image, or SEO fields.
4. Temporarily remove WordPress KSES filters around the post update.
5. Download/localize remote content images and optionally replace the featured image.
6. Update the slug-keyed tracking row and third-party SEO metadata.
7. Return a simple success response, sometimes with warning strings.

WordPress hooks update the local tracking row when post status changes and delete that row when a
post is permanently deleted. They do not send changes to the SaaS.

## Backend contract visible from the plugin

The Outrank backend implementation is not present in this repository. The plugin only reveals the
interface the backend calls.

The create request can carry a site secret plus title, slug, creation time, rendered content,
featured-image URL, author, category, tags, meta description, focus keyword, and focus keyphrase.
The edit request can carry a WordPress post ID or current slug plus any mutable article fields.
The backend therefore appears to own the article and image data and sends a ready-to-publish
payload; the plugin does not generate, plan, bill, or orchestrate content.

The plugin source does not establish how Outrank stores connections, schedules backend jobs,
retries failed calls, prevents duplicate deliveries, or reconciles local WordPress changes. Those
behaviors cannot be determined from this repository alone.

## Reusable functionality

- Native WordPress post creation and update calls.
- Draft and publish status transitions.
- Category and tag resolution concepts.
- Media Library attachment creation, metadata generation, source-URL lookup, featured-image
  assignment, and attachment ownership updates.
- Content-image localization concepts.
- Content sanitization with explicit YouTube and YouTube-nocookie iframe allowlisting.
- Slug generation and collision handling concepts.
- Multisite-aware activation and per-site table setup.
- Administrator settings guarded by `manage_options` and WordPress admin nonces.
- Local WordPress status and deletion hooks.
- The thin product boundary in which the SaaS sends a complete article and WordPress only stores
  and renders it.

## Naming and inherited surfaces

Public and persistent Outrank identifiers exist throughout the plugin:

- Plugin name, header metadata, icon, descriptions, URLs, menu labels, and readme text.
- PHP functions, constants, action names, asset handles, CSS classes, and REST namespace.
- Options, custom table name, post/attachment metadata, integration ID, cache keys, and page slugs.
- Third-party SEO metadata writers and Squirrly-specific serialized database behavior.

The local dashboard, global draft/publish preference, arbitrary author selection, broad post
listing, integration test route, third-party SEO-plugin writes, old compatibility hooks, and unused
assets are distinct inherited product behaviors. Whether to retain, rename, or remove any of them
is a product decision, not an audit conclusion.

## Security findings

### Authentication and authorization

- A route-level secret is hard-coded in the distributed plugin, so every installation shares it.
- The site API key is accepted in JSON bodies and some inherited flows place credentials in query
  parameters, increasing exposure through logs and intermediaries.
- Requests are not signed. There is no timestamp, nonce, body digest, secret rotation, or replay
  protection.
- Several routes are anonymous, including the broad post-listing and mutating integration-test
  surfaces.
- The edit route accepts an arbitrary WordPress post ID or slug and is not constrained to content
  originally created by the integration.
- Author selection is supplied by the caller rather than bound to an administrator-approved local
  publishing identity.

### Publishing identity and duplication

- Mutable slug is the only tracking identity.
- The custom table does not retain WordPress post ID or an immutable external article ID.
- Network retries have no idempotency key or durable duplicate-prevention rule.
- A retry can create a second WordPress post with a suffixed slug.
- A local slug change can disconnect the WordPress post from its tracking row.
- Permanent deletion removes the only tracking row instead of retaining a deletion marker.

### Media handling

- Remote image downloads explicitly disable TLS certificate verification.
- Arbitrary remote URLs are accepted without a trusted-origin policy or private-address checks.
- There are no strict redirect, response-byte, decoded-pixel, or download-time limits.
- File extension and fallback MIME behavior can disagree with the downloaded bytes.
- SVG is accepted despite its active-content risk.
- Failure cleanup can delete an attachment that was reused rather than created by the current
  request.
- Inline content-image localization broadens the outbound request surface further.

### Content and data exposure

- The broad posts route can disclose posts outside the integration's ownership boundary, including
  non-public statuses depending on its inputs.
- The edit flow removes KSES filters while updating content, increasing the impact of validation
  mistakes or third-party behavior.
- Raw database and WordPress error messages can be returned to callers.
- Direct writes to several third-party SEO plugins couple the adapter to their internal metadata.
- Direct Squirrly table serialization is especially fragile across plugin versions.

### Synchronization

- Status and deletion hooks update only the local custom table.
- No local status, URL, slug, trash, untrash, or permanent-deletion change is sent to the SaaS.
- Deletion destroys tracking identity rather than recording a durable terminal state.
- There is no retry queue or reconciliation mechanism for local changes.

## Gap inventory against the stated v1 capabilities

- **Connect/disconnect:** API-key settings and an integration-ID setter exist, but there is no
  complete site connection lifecycle or coordinated disconnect.
- **Health/capabilities:** a small unsigned capability response and a mutating unsigned test route
  exist; there is no safe authenticated health contract.
- **Create/update:** both exist, but updates are selected by caller-supplied WordPress ID or slug
  rather than immutable SaaS ownership.
- **Draft/publish/scheduled:** draft/publish are controlled by one global option. Edit accepts raw
  WordPress statuses, but there is no explicit scheduled-publication contract with validated UTC
  time handling.
- **Media/featured image/alt text:** remote ingestion and featured images exist. Safe download
  boundaries and a defined alt-text contract are absent.
- **Categories/tags:** basic resolution and assignment exist.
- **YouTube embeds:** the sanitizer has explicit YouTube and YouTube-nocookie handling.
- **External SEO Potion article IDs:** absent.
- **Idempotency/duplicate prevention:** absent beyond best-effort slug uniqueness.
- **Structured errors:** responses are ad hoc and may expose internal messages.
- **Status/URL/slug/trash/deletion synchronization:** local mirror updates exist, but SaaS
  synchronization is absent.
- **Per-site HMAC/timestamp/replay authentication:** absent.

## Licensing and attribution findings

- The upstream plugin declares `GPLv2 or later`; a distributed derivative must remain compatible
  with `GPL-2.0-or-later` and include the license text.
- Clear attribution to Outrank 1.0.10, Outrank, and the identified contributor `eugenezolo` should
  be preserved.
- Modified work should be identified as modified rather than represented as entirely original.
- Outrank branding and trademarks should not be used as SEO Potion's product identity.
- The separate SaaS backend is not part of the distributed WordPress derivative merely because it
  communicates with the plugin over HTTP.
- WordPress.org distribution requires an accurate external-service disclosure for SEO Potion and
  any remote media service contacted by the plugin.
- This is an engineering assessment, not legal advice.

References used during the audit:

- https://wordpress.org/plugins/outrank/
- https://developer.wordpress.org/plugins/wordpress-org/detailed-plugin-guidelines/
- https://www.gnu.org/licenses/gpl2.html

## Verification limitations

- No PHP executable was available in the local environment during the audit.
- The Docker CLI was installed, but its daemon was not running.
- The imported plugin had no PHP/WordPress test harness or plugin-specific CI.
- Findings came from static source inspection and comparison with the official Outrank 1.0.10
  package; runtime behavior was not independently exercised.

## Implementation handoff — 2026-07-14

### Current outcome

The thin SEO Potion WordPress integration is implemented across the plugin, API, shared data
layer, and web app. It supports connecting a self-hosted WordPress site, creating an article,
remembering the returned WordPress post ID, and updating the same post later.

The implementation deliberately preserves the inherited Outrank 1.0.10 plugin behavior and
contracts. The security and synchronization findings in the historical audit above are not fixed
unless this section explicitly says otherwise.

The current state is a functional pre-release prototype, not merge-ready or release-ready. Complete
the remaining must-fix list before merge. The deferred security items require explicit product and
security acceptance before any public release if they are not addressed first.

No existing MongoDB document requires a migration and no new index is required. All new entity
fields are optional. The WordPress fork is fresh-install-only; it does not migrate Outrank options,
tables, metadata, or existing installations.

### Changed-file map

- Shared entity contracts: `packages/shared/schemas/src/{org,article}.ts` and their tests.
- MongoDB persistence: `packages/shared/db/src/repositories/{org,article}.repo.ts` and repository
  integration tests.
- SaaS API: `apps/api/src/clients/wordpress.ts`, `apps/api/src/routes/dashboard.ts`,
  `apps/api/src/schemas/dashboard.ts`, `apps/api/src/config.ts`, and related API tests.
- Web UI: Settings, Home, article detail, onboarding integration choice, and `messages/{en,tr}.json`
  under `apps/web`.
- WordPress plugin: bootstrap, REST implementation, settings page, assets, and readme under
  `apps/integration-clients/wordpress-org`.

### Completed plugin work

- Forked and rebranded the plugin as SEO Potion 1.0.0 while retaining the GPLv2-or-later license
  declaration and explicit Outrank 1.0.10 attribution.
- Renamed the bootstrap to `seo-potion.php` and the REST namespace to `seo-potion/v1`.
- Mechanically renamed PHP functions, constants, options, cache keys, metadata, admin slugs,
  assets, CSS classes, and JavaScript identifiers to SEO Potion names.
- Renamed the tracking table to `{prefix}seo_potion_manage` without changing its schema or
  slug-based behavior.
- Preserved the inherited local dashboard, draft/publish setting, multisite lifecycle, create and
  edit behavior, media localization, SEO-plugin metadata writes, local status/deletion hooks,
  post listing, integration-ID setter, capabilities route, and integration test.
- Kept the route-wide secret identical in `apps/api/src/config.ts` and
  `apps/integration-clients/wordpress-org/libs/api.php`. These values must be changed together.
- Replaced deprecated `arguments.callee` usage in the inherited plugin JavaScript; no plugin runtime
  behavior was intentionally changed.

Intentional Outrank references remain only in fork attribution and upstream changelog history.

### Completed backend and data work

- Added optional `wordpress_token` and `wordpress_connected_at` fields to `OrgSchema` and a
  repository method that stores a successfully tested connection. The existing `Org.website_url`
  is the WordPress base URL; there is no integration collection.
- The current contract assumes `Org.website_url` is the actual WordPress installation base URL.
  There is no separately editable integration URL, so subdirectory WordPress installations,
  headless sites, and organizations whose marketing domain differs from WordPress need an explicit
  product decision.
- Added optional positive-integer `wordpress_post_id` to `ArticleSchema`, excluded it from
  `CreateArticleInput`, and added a repository method that records the ID returned by WordPress.
  There is no separate article-mapping collection.
- Added `marked` to render stored GFM Markdown to HTML only at the outbound WordPress boundary.
  Stored article content remains Markdown.
- Added one small WordPress client in `apps/api/src/clients/wordpress.ts` for connection testing,
  article creation, and article updates.
- Added authenticated, ownership-checked dashboard routes for connecting WordPress, reading the
  redacted connection state, creating a WordPress post, and updating it.
- Kept the internal Article `status`, `published_at`, and other publication state unchanged after
  WordPress operations because the inherited plugin response does not report the final WordPress
  status or URL.
- Kept tokens out of core organization and connected-integration responses. The connected response
  contains only the provider identity and connection timestamp.

### Completed frontend work

- Replaced the placeholder integration section in Settings with a self-hosted WordPress connect
  and test flow using the typed Hono client.
- Reuses the active organization's URL as a read-only WordPress URL, accepts the per-site token in
  a password input, and never redisplays a stored token.
- Displays persisted WordPress connection state in Settings and includes it in the Home integration
  count.
- Added an article-detail action that calls create when `wordpress_post_id` is absent and update
  when it is present.
- Stores the returned post ID in local page state and displays plugin errors and update warnings.
- Added English and Turkish text and changed onboarding provider copy from WordPress.com to
  self-hosted WordPress.
- Uses accurate Send/Sending/Sent wording because the plugin may save a draft, and makes Enter in
  the Settings token field run Connect & Test instead of submitting general settings.
- Uses a plugin-first token flow in the plugin settings, web help text, and plugin readme: choose and
  save a strong token in WordPress, then paste the same token into SEO Potion Settings.
- Tells users during onboarding that WordPress can be connected later from Settings.

Frontend status: the thin happy path is functionally wired, but the frontend is not release-tested.
There are no automated component or end-to-end tests under `apps/web`. The article action is shown
even when WordPress is disconnected and relies on a backend 409 response; readiness-aware controls,
disconnect, live health, WordPress post URL/status display, and structured localized article errors
are deferred or require backend contract changes. English, Turkish, mobile, and keyboard flows
still need manual browser verification.

### SaaS API contracts

All routes below require the SEO Potion Bearer JWT and enforce organization/article ownership.

| SaaS route | Request | Result |
| --- | --- | --- |
| `POST /api/v0/dashboard/integrations/wordpress` | JSON `{ org_id, token }` | Tests the plugin and stores the token/timestamp only after success. |
| `GET /api/v0/dashboard/integrations/connected?org_id=...` | Organization query | Returns an empty list or redacted WordPress connection metadata. It is not a live health check. |
| `POST /api/v0/dashboard/articles/{id}/wordpress` | No body | Requires a stored connection and complete article images, creates the WordPress post, then stores `post_id`. |
| `PUT /api/v0/dashboard/articles/{id}/wordpress` | No body | Requires a stored connection and `wordpress_post_id`, then updates that WordPress post. |

Connection errors use 403 for rejected/unconfigured site tokens, 404 for missing or foreign
organizations, and 502 for other plugin failures, network failures, or invalid plugin responses.
Article routes pass through the plugin's supported 400, 403, 404, 409, and 500 error bodies; network
or invalid responses become 502 responses from the SaaS API.

### Plugin contracts used by the SaaS

| Plugin route | Authentication | SaaS usage |
| --- | --- | --- |
| `POST /wp-json/seo-potion/v1/test-integration` | JSON `secret` only | Connection test; creates and immediately deletes a draft. |
| `POST /wp-json/seo-potion/v1/submit` | `X-Secret-Key` plus JSON `secret` | Creates a native WordPress post. |
| `PUT /wp-json/seo-potion/v1/edit` | `X-Secret-Key` plus JSON `secret` | Updates by stored WordPress post ID. |
| `GET /wp-json/seo-potion/v1/posts` | Per-site key | Preserved but not called by the SEO Potion backend. |
| `POST /wp-json/seo-potion/v1/set-integration-id` | Per-site key | Preserved but not called by the SEO Potion backend. |
| `GET /wp-json/seo-potion/v1/capabilities` | No authentication | Preserved but not called by the SEO Potion backend. |

The current two-secret contract is inherited and temporary; it is not an approved long-term
security design:

1. `X-Secret-Key` is one shared route-wide value compiled into both the distributed plugin and the
   API source. It protects only create/edit routes and can be recovered from every distributed
   plugin build. The current API and plugin values must continue to match.
2. JSON `secret` is the per-site token chosen by the administrator. WordPress stores it in the
   `seo_potion_api_key` option and SEO Potion stores it on the Org document.
3. The integration test intentionally sends only the per-site JSON secret.

### Outbound article mapping

Create sends:

- `secret`
- `title`
- `slug`
- `created_at`
- rendered HTML `content`
- optional `image_url`
- `meta_description`
- `focus_keyword`

Update sends the same mutable content fields plus the stored WordPress `id`, without `created_at`.

The backend intentionally omits author, category, tags, status, focus keyphrase, and meta title.
The plugin therefore applies its locally configured draft/publish mode and inherited defaults for
author and category. A successful plugin response is `{ success: true, post_id, warnings? }`.

### End-to-end data flow

1. A WordPress administrator installs the plugin, enters a per-site token, and chooses draft or
   direct-publish mode.
2. The same token is entered in SEO Potion Settings. The API calls the plugin's integration test;
   only a successful test persists the connection in MongoDB.
3. On create, the API loads the owned Org and Article, renders Markdown to HTML, and calls the
   plugin with both secrets.
4. WordPress creates the post, downloads/localizes images, writes SEO metadata and its tracking
   row, and returns the WordPress post ID.
5. SEO Potion stores that ID on the Article. Later updates target the stored ID.
6. WordPress status/deletion hooks update only the plugin's local table. They do not notify SEO
   Potion or change the SaaS Article state.

### TODO — must fix before merge or release

- [ ] **[backend/schema]** Remove `wordpress_token` and `wordpress_connected_at` from
  `CreateOrgInput`; they are server-owned fields. Add protection in
  `packages/shared/schemas/tests/org.test.ts` matching the existing Article input test.
- [ ] **[backend/routes]** In `apps/api/src/routes/dashboard.ts`, reject
  `POST /articles/{id}/wordpress` when `wordpress_post_id` already exists so a direct sequential
  retry cannot create and remap another post. Add a 409 test in `apps/api/tests/dashboard.test.ts`.
- [ ] **[backend/routes]** Require `images_status === 'complete'` on WordPress updates as well as
  creates. Add an update-readiness route test in `apps/api/tests/dashboard.test.ts`.
- [ ] **[backend/db]** Make `OrgRepo.saveWordPressConnection` and
  `ArticleRepo.setWordPressPostId` report whether a MongoDB document matched. Check the result in
  routes and add Article repository integration coverage.
- [ ] **[plugin]** In `apps/integration-clients/wordpress-org/libs/api.php`, fix false-success
  handling: `wp_insert_post()` can return `0`, but the create helper and integration test currently
  check only `is_wp_error()`. Use the error-returning form and reject non-positive IDs.
- [x] **[product/frontend/plugin]** Define and document one token-provisioning flow: choose and save
  a strong token in WordPress first, then paste it into SEO Potion Settings.
- [x] **[frontend]** Replace visible "Publish/published" WordPress wording with "Send/sent" because
  the plugin can save a draft and its response does not report final status.
- [x] **[frontend]** Make Enter in the Settings token field run Connect & Test instead of
  submitting the outer general-settings form.
- [x] **[frontend]** Tell onboarding users that WordPress can be connected later from Settings;
  onboarding integration selection itself remains local-only and is not persisted.
- [ ] **[docs]** Update `PROGRESS.md` and the linked integration issue so they no longer describe
  integrations as entirely empty/unimplemented. Preserve the distinction between this thin
  WordPress path and the still-deferred general setup-integration API.
- [ ] **[git]** Preserve the entire working tree before switching branches or restacking. At this
  handoff, `HEAD` still equals `origin/frontend`, the branch is nine commits ahead of `origin/dev`,
  and the current WordPress feature has no commit. Critical untracked paths include
  `apps/integration-clients/wordpress-org/`, `apps/api/src/clients/wordpress.ts`,
  `apps/api/tests/wordpress-client.test.ts`, and `alpersNotes/`.
- [ ] **[git]** Keep unrelated files out of the PR and decide whether this handoff document should
  be committed or shared separately. `.gitignore` contains `alperNotes/` (singular), which does not
  match the actual untracked `alpersNotes/` directory.

### TODO — release packaging and runtime verification

- [ ] Add the full GPL license text to the plugin package.
- [ ] Create a reproducible ZIP with one top-level `seo-potion/` directory and exclude `.DS_Store`
  and development-only files. An ignored `.DS_Store` currently remains in the plugin directory on
  disk.
- [ ] Confirm the WordPress.org slug, maintainer/contributor username, plugin version, minimum PHP
  and WordPress versions, and the version used for `Tested up to`.
- [ ] Confirm the SEO Potion service/app URL used in `readme.txt`. Rewrite the external-service
  disclosure to describe the actual push flow and remote image downloads, and add final Terms and
  Privacy URLs.
- [ ] Provide the three declared screenshots or remove the Screenshots section until directory
  assets exist.
- [x] Run `php -l` on every plugin PHP file. All six files pass on local PHP 8.5.8.
- [ ] Run WordPress Coding Standards and the official Plugin Check tool. Neither tool is configured
  locally. Separately verify PHP 8.0 compatibility because linting on PHP 8.5 does not prove the
  declared minimum version.
- [ ] Start MongoDB with `docker compose up -d mongo`, then run `npm run test:integration`.
- [ ] In the standalone infra package, run `cd infra && npm install` if dependencies are missing,
  then `npm run synth` to prove the API Lambda bundles `marked` correctly.
- [ ] Install the release ZIP on a disposable WordPress site and test invalid/missing tokens,
  unconfigured plugin, successful connection, token redaction, draft and direct-publish modes,
  create/reload/update, warnings, deletion, retries, Markdown HTML, slugs, SEO metadata, featured
  images, and inline images.
- [ ] Verify the Settings and article flows in English and Turkish, on mobile, and with keyboard
  submission.
- [ ] Deploy and verify the API/OpenAPI routes before deploying the web UI. Install a plugin build
  carrying the matching route-wide secret.

### TODO — deliberately deferred hardening and product capabilities

These items were outside the thin-fork implementation. They remain important for a public release
and should be tracked explicitly rather than assumed fixed.

- [ ] Replace or redesign the distributed shared route secret; add rotation, request signing,
  timestamps, and replay protection if the product security model requires them.
- [ ] Add outbound-request timeouts and private-network protection in the API. The current Lambda
  timeout is 30 seconds while WordPress may synchronously download multiple images.
- [ ] Harden remote media downloads: enable TLS verification, restrict schemes/origins and SVG,
  validate actual MIME types, and add redirect, byte, pixel, and time limits.
- [ ] Decide whether per-site tokens require encryption at rest, rotation, and revocation rather
  than plaintext MongoDB and WordPress option storage.
- [ ] Add a disconnect/reconnect lifecycle and live health/capability checks.
- [ ] Design durable idempotency and recovery for the case where WordPress creates a post but the
  API times out or cannot persist the returned ID.
- [ ] Add reconciliation or callbacks for WordPress URL, status, slug, trash, untrash, and deletion
  changes.
- [ ] Constrain edit/list behavior to integration-owned posts if inherited broad access is not an
  accepted product decision.

### Verification state at handoff

- `npm run lint`: passes with no warnings.
- `npm run check:all`: passes.
- Focused keyword, WordPress client, and dashboard tests: 98 tests pass.
- Full unit suite: all 293 tests pass when the CLI smoke test can create its local `tsx` IPC socket.
  A restricted sandbox may report 292/293 with only `apps/cli/tests/cli-smoke.test.ts` failing with
  `listen EPERM`; rerunning outside that restriction passes.
- `git diff --check`: passes for tracked changes. It does not inspect untracked files; after staging
  the intended handoff, also run `git diff --cached --check`.
- PHP 8.5.8 is installed through Homebrew, and all six plugin PHP files pass `php -l`.
- WordPress Coding Standards, Plugin Check, minimum-PHP compatibility, and a real WordPress runtime
  have not been exercised.
- Mongo integration tests have not run because the Docker daemon is stopped.
- The imported plugin still has no PHP/WordPress automated test harness.
- The WordPress frontend flow has no automated component or end-to-end coverage; browser QA remains
  outstanding.

The repository CI order remains `npm run lint`, `npm run check:all`, then `npm test`. Backend staging
deploys only after the repository's `dev` branch is merged to `master`; a push to `dev` alone does
not deploy the API.
