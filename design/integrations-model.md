# Integrations Model (generalised publishing connections)

**Status: built.** This is the entity behind issue
[#7](https://github.com/seopotion/seo/issues/7) and gap **G1** in
[`onboarding-parity-gaps.md`](onboarding-parity-gaps.md). It is the storage layer
[`static-site-integration.md`](static-site-integration.md) defers to — that doc froze the
*bytes* we write into a client repo and explicitly left "where repo/branch/installation id
live" to this one.

Landed 2026-07-30: the `integrations` collection + both indexes, `IntegrationRepo`,
`article.publications[]` + its backfill, the widened `GET /integrations/connected`, the
single `DELETE /integrations/{provider}`, and WordPress connect writing the entity with an
encrypted token. `POST /integrations/static-site` followed the same day, once
[`clients/github.ts`](../apps/api/src/clients/github.ts) existed to verify against
(§ API surface). Two deferrals stand, each with its reason below: **the WordPress token
backfill and dropping the org mirror** (§ Migration), and **the `DATA_KEY_PARAM` rename**
(§ Secrets).

## The problem

*(As of 2026-07-30 this section is history — every row is resolved except the two the
Migration section keeps alive on purpose. Kept because it is the argument for the shape.)*

There was no integration entity. "Connected to WordPress" was spelled out longhand in six
places, none of which could express a second provider:

| What was hardcoded | Now |
| --- | --- |
| `wordpress_token` + `wordpress_connected_at` as fields on the **org** | Deprecated mirror; the connection lives in `integrations` |
| `OrgRepo.saveWordPressConnection` / `clearWordPressConnection` | Still called, to maintain that mirror |
| `/integrations/connected` returned a **literal** one-element array | Reads `IntegrationRepo`, plus the mirror fallback |
| `provider: z.literal('wordpress')` — the wire type admitted nothing else | `z.enum(INTEGRATION_PROVIDERS)` + a display `target` |
| `wordpress_post_id` — the same hardcoding one level down | Deprecated mirror of `publications[]` |
| `ONBOARDING_INTEGRATIONS` had no `static-site` member | Added, with a test pinning the invariant |

The static-site integration needs to persist a repo, a branch, an installation id and a
content path. There was nowhere to put them that was not "four more fields on `orgs`".

## Decisions

| Concern | Choice |
| --- | --- |
| Storage | A new **`integrations` collection**, one document per (org, provider) — not more fields on `orgs` |
| Shape | **Top-level `z.discriminatedUnion('provider', …)`**, common fields repeated in each member |
| Provider key | **`static-site`**, not `github` — the git host is a field inside it |
| Cardinality | **One integration per (org, provider)**, unique-indexed |
| GitHub credentials | Store the **installation id only**. Tokens are minted per publish and never persisted |
| WordPress credentials | Move the token off the org and **encrypt at rest** with the existing AES-256-GCM helper |
| Per-article state | `article.wordpress_post_id` → **`article.publications[]`**, keyed by provider |
| Migration | Backfill in [`migrations.ts`](../packages/shared/db/src/migrations.ts); old fields deprecated, not dropped in the same change |

## Why this shape

**A collection, not org fields.** [`GscConnectionRepo`](../packages/shared/db/src/repositories/gsc-connection.repo.ts)
already set this precedent for the same reason: an external connection has its own
lifecycle, its own failure state, and a disconnect that is a `deleteOne` rather than an
`$unset` of N fields. The sharper argument is the hot path — `loadOwnedOrg` runs on
essentially every authenticated route, so today **every dashboard request pulls a
publishing secret into memory** to answer questions that have nothing to do with
publishing. Integrations belong in a document that only the publish paths read.

**Discriminated union at the top level, not a nested `config`.** Nesting would push
`provider` to `config.provider`, which makes the Mongo query and its index a dotted path
for no gain. With the union flat, TypeScript still lets `integration.connected_at` be read
without narrowing (the field exists on every member), and narrowing kicks in exactly where
it should — the moment you touch `repo` or `token_enc`.

**`static-site`, not `github`.** The contract is host-neutral by construction; GitLab and
Bitbucket have equivalent tree APIs and only the client module would differ. Making the
host a *field* means a second host is a new `host` value, not a second provider with a
duplicated config shape.

**Installation id, no token.** A GitHub App installation token lives ~1 hour, so storing
one is both useless and a liability. We store the installation id and mint a token per
publish from the App private key. **The static-site integration therefore has no secret at
rest at all** — the client can revoke us from their GitHub settings without our
cooperation, which is the whole reason for choosing an App over a PAT.

## The entity

```ts
// packages/shared/schemas/src/integration.ts

/** Publishing targets we can actually connect to. Subset of ONBOARDING_INTEGRATIONS,
 *  which also lists platforms we only ask about (`wordpress-com`, `framer`). */
export const INTEGRATION_PROVIDERS = ['wordpress', 'static-site'] as const;

const IntegrationBase = z.object({
  id: z.string(),
  org_id: z.string(),
  connected_at: z.date(),
  // Last failure from a publish or a connectivity check; cleared on success.
  // Lets the UI show "connected but broken" instead of silently failing later.
  last_error: z.object({ code: z.string(), at: z.date() }).nullable().default(null),
});

export const IntegrationSchema = z.discriminatedUnion('provider', [
  IntegrationBase.extend({
    provider: z.literal('wordpress'),
    // Denormalized from org.website_url at connect time: the org's URL can change,
    // the site we hold a token for cannot.
    site_url: z.string().url(),
    token_enc: z.string(),
  }),
  IntegrationBase.extend({
    provider: z.literal('static-site'),
    host: z.literal('github'),
    installation_id: z.number().int().positive(),
    repo: z.string(), // "owner/name"
    branch: z.string(),
    // The one contract path (static-site-integration.md § The contract). Images are
    // not committed — they stay on our CDN and are referenced by absolute URL.
    content_path: z.string(),
  }),
]);
export type Integration = z.infer<typeof IntegrationSchema>;
```

The `content_path` default (`seopotion/`) is applied **at the route**, not in the schema —
a stored document always carries the literal value it was connected with, so changing our
default later cannot silently repoint an existing install's files.

**Index** ([`ensure-indexes.ts`](../packages/shared/db/src/ensure-indexes.ts)):

```ts
await db.collection('integrations').createIndex({ org_id: 1, provider: 1 }, { unique: true });
// One GitHub installation binds to exactly one org (github-app.md § Why state is not optional).
await db.collection('integrations').createIndex(
  { installation_id: 1 },
  { unique: true, partialFilterExpression: { provider: 'static-site' } },
);
```

One per provider per org, because an org *is* one website ([`org.ts`](../packages/shared/schemas/src/org.ts)
has a single `website_url`). Multi-repo orgs would be a matter of dropping the unique flag,
so nothing here forecloses it — but there is no such requirement today.

## Per-article publish state

`wordpress_post_id` is the same problem below the org level, and the static-site publisher
cannot reuse it: there is no post id, and republishing needs to know **what slug we last
committed under**.

```ts
export const ArticlePublicationSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  // The provider's handle on the published object: WordPress post id as a string,
  // or the commit sha of the last publish for static-site.
  ref: z.string(),
  // The slug this article was ACTUALLY published under — NOT derivable from
  // article.slug, which the editor can change (schemas/dashboard.ts:253).
  slug: z.string(),
  published_at: z.date(),
  updated_at: z.date().nullable(),
});

// ArticleSchema
publications: z.array(ArticlePublicationSchema).default([]),
```

**The slug-change trap.** The editor exposes `slug` as an editable field
([`ArticleUpdateBody`](../apps/api/src/schemas/dashboard.ts#L250-L258)), and the static-site
contract addresses the file by slug. Rename after publishing and the republish commit
writes `new-slug.md` while `old-slug.md` stays in the client's repo forever. The manifest
drops the old entry so `includedRoutes` stops prerendering it, but the file remains — and
it comes back as a live page the moment an adapter globs the content directory instead of
reading the manifest, or a deploy step rsyncs without `--delete` (a from-scratch rebuild,
as Coolify and the hosted platforms do, is immune to the second but not the first). Since
the 2026-07-30 revision the orphan is one text file rather than a file plus an image
directory, which makes it cheaper but no less wrong. Comparing
`publication.slug` to `article.slug` at publish time is what makes the delete-old-paths
step possible; without the stored value there is nothing to compare against.

`wordpress_post_id` stays as a deprecated mirror for one release — it is on the wire in
[`ArticleDetailResponse`](../apps/api/src/schemas/dashboard.ts#L217) and read by the web
app — and is dropped once `publications[]` is populated everywhere.

## API surface

**Generalised read.** `provider: z.literal('wordpress')` becomes
`z.enum(INTEGRATION_PROVIDERS)`, and the response gains a display target so the settings
panel can render "connected to `owner/repo@branch`" rather than a bare provider name. This
is a deliberate breaking type change: [`apps/web/lib/integrations.ts:8`](../apps/web/lib/integrations.ts#L8)
declares the same literal by hand and will fail `check:web` until updated — the typed-client
chain doing its job. The `id` field, today the literal string `'wordpress'`, becomes the
real document id; it is opaque to the frontend, so nothing else changes.

| Route | Purpose |
| --- | --- |
| `GET /dashboard/integrations/connected` | Unchanged path; response widened to the provider enum |
| `POST /dashboard/integrations/static-site` | Connect: `{ grant, repo, branch, content_path? }` |
| `DELETE /dashboard/integrations/{provider}` | Disconnect — one route replacing per-provider variants |
| `GET`/`POST /setup/integrations` (#7) | Onboarding-time view of the same entity |

The static-site connect body carries a signed `grant` rather than an `org_id` +
`installation_id` pair, because an installation id is a guessable integer and not a secret —
see [`github-app.md` § Why `state` is not optional](github-app.md#why-state-is-not-optional-here).
Both values are read out of the grant, so a client cannot name either one.

**Why `POST /integrations/static-site` landed a step later.** "Verify before you save"
(below) is not optional for this provider, and verifying means minting an installation token
and reading the repo — i.e. `apps/api/src/clients/github.ts`, which did not exist when the
rest of this model shipped. A connect route that skipped the check would store unverified
coordinates and relocate the failure to the customer's first publish, which is the exact
thing the next paragraph forbids. So it shipped with that client, together with the two
install-flow routes that produce the `grant`, as one coherent change rather than a route
with a hole in it.

All three live in [`routes/integrations.ts`](../apps/api/src/routes/integrations.ts), a
second router mounted at `/dashboard/integrations` — the split
[`gsc.ts`](../apps/api/src/routes/gsc.ts) already makes for the Google OAuth dance. The
older integration routes stayed in `dashboard.ts`; moving them would have been a refactor
this change did not need.

**Verify before you save.** `POST /integrations/wordpress` already calls
`testWordPressIntegration` and refuses to persist a token that does not work
([`dashboard.ts:344-361`](../apps/api/src/routes/dashboard.ts#L344-L361)). The static-site
connect holds the same line: `verifyRepoAccess` mints the scoped installation token —
which is itself the `contents: write` check, since the mint requests that permission
explicitly and 422s without it — then reads `GET /repos/{repo}/branches/{branch}`, and only
then inserts. A connection that stores unverified coordinates just relocates the failure to
the user's first publish.

**The 409.** `IntegrationRepo.connectStaticSite` returns `false` rather than throwing when
the installation is already bound elsewhere: it catches Mongo's `11000` from the partial
unique index. Doing it that way — instead of a `findOne` first — means two simultaneous
claimants cannot both pass a check-then-write, and keeps the driver's error code from
leaking into a route handler.

**Re-scoping #7.** The issue is written as two endpoints; the connected-CMS entity it
names as missing is this document. #7 should build against this model rather than invent a
parallel one — that was the issue's own instruction ("build the entity once").

## Secrets

WordPress is the only provider with a secret at rest, and today it is stored in plaintext
on the org. It moves to `token_enc` using the existing AES-256-GCM helpers
([`lib/crypto.ts`](../apps/api/src/lib/crypto.ts)), the same treatment GSC refresh tokens
already get.

That key is currently named for its first user — `GSC_TOKEN_KEY_PARAM`
([`config.ts:24`](../apps/api/src/config.ts#L24)). Reusing it for a WordPress token makes
the name a lie, so it should become a neutral `DATA_KEY_PARAM`.

**Deferred, deliberately.** The rename is not one accessor: the SSM *path*
(`/seo/<stage>/gsc-token-key`) is live on two stages and is one of the names the
`cli preflight` SSM check asserts, so renaming means creating the parameter under a second
path, redeploying, and only then deleting the old one — an ops sequence with a window where
a mistake locks every encrypted read. That is a poor thing to bundle into a data-model
change. It is worth doing on its own, and worth doing before a third consumer arrives.

Two consequences of the current name are already visible: connecting WordPress locally now
needs `GSC_TOKEN_KEY` set (noted in `.env.example`), and the **admin Lambda has no data
key at all** — it is granted only its own secrets by design
([`api-stack.ts`](../infra/lib/api-stack.ts)), which is what forces the mirror arrangement
described under Migration.

Unrelated to the above and worth stating plainly: the GitHub App private key must **not**
follow the [`WORDPRESS_ROUTE_SECRET`](../apps/api/src/config.ts#L17) precedent — a
plaintext literal in git, shared across every install. SSM SecureString, API Lambda only,
same pattern as the JWT secret; the details are in
[`github-app.md` § The private key](github-app.md#the-private-key).

## Migration

One backfill landed in [`runMigrations()`](../packages/shared/db/src/migrations.ts), which
already runs before `db init` on deploy: for each article with `wordpress_post_id`, push a
`publications[]` entry (`ref` = the id as a string, `slug` = `article.slug`, `published_at`
= `article.published_at ?? article.created_at`). Its `slug` is a best-effort
reconstruction — if a pre-migration article was published and *then* renamed, we record the
current slug, not the published one. That only affects WordPress, which addresses by post
id and does not care; static-site articles all postdate this change, so their values are
exact.

**The org→integration backfill is not there, and should not be.** It would have to encrypt
each token, and `runMigrations` runs from the CLI and the `db init` Lambda — neither of
which holds the data key. Getting one there means either lifting `lib/crypto.ts` into a
shared package or threading an `encryptToken` callback through the migration API, both of
which are real changes made *for a backfill whose value is zero today*: the plaintext
`org.wordpress_token` is still sitting in the same database, so encrypting a duplicate
protects nothing until the mirror goes.

So the expand phase runs the other way round. `POST /integrations/wordpress` writes both
the entity (encrypted) and the mirror; `GET /integrations/connected` reads the entity and
**falls back to the mirror** when there is no row, which is exactly the state the admin
connect lever leaves behind — it writes only the org fields, because the admin Lambda has
no data key (§ Secrets). Publishing still reads the mirror everywhere, so `token_enc` is
written and not yet read: normal for expand/contract, and covered by a repo round-trip test
rather than by production traffic.

The contract phase is one change: backfill + encrypt from the API side where the key
already is, flip every token read to the entity, delete the fallback, then drop
`org.wordpress_token` / `wordpress_connected_at`, the org-level repo methods, and the admin
levers' direct field access
([`admin/routes/orgs.ts:358`](../apps/api/src/admin/routes/orgs.ts#L358), [`:428`](../apps/api/src/admin/routes/orgs.ts#L428)) —
which is also the point at which the admin Lambda must be granted the data key, or lose the
WordPress levers. **Until then the mirror is load-bearing, not vestigial.**

**It did not ride along with the publish route** (`3.5`), as this section previously
assumed it would. The static-site publisher holds no secret at all — that is the whole
point of the installation-token design — so the two changes share nothing but a release,
and bundling them would put a destructive schema change against live staging data in the
same diff as a new endpoint. One thing genuinely does need deciding first: **what triggers
the backfill.** "From the API side" names a place, not a mechanism — `runMigrations()` is
the natural home and is exactly the process that cannot hold the key. A boot-time pass in
the API Lambda, a one-off admin route, or threading an `encryptToken` callback into the
migration API are all plausible; none is obviously right, and the answer sets the shape of
the whole change.

## Onboarding vs. connected

These are different lists and stay different. `ONBOARDING_INTEGRATIONS` is intent capture —
it includes `wordpress-com` and `framer`, which we cannot connect to and may never — while
`INTEGRATION_PROVIDERS` is what we can actually write to. The invariant is one-directional:
every connectable provider must also be selectable at onboarding, so `static-site` is added
to `ONBOARDING_INTEGRATIONS` alongside the enum. The comment on
[`org.ts:37-38`](../packages/shared/schemas/src/org.ts#L37-L38) already draws this
distinction; this keeps it true.

## Deliberately out of scope

- **The GitHub App itself** — registration, permission scoping, the installation callback
  that yields `installation_id`. *Designed: [`github-app.md`](github-app.md).*
- **`POST /articles/{id}/publish`** — the publish route and the atomic-commit client read
  this model but are designed separately. *Both built (2026-07-30/31); the route is the
  first and so far only reader of `publications[].slug`, which it uses to delete the
  previously-committed file when the editor has renamed an article.*
- ~~**Slug uniqueness.**~~ *Resolved 2026-07-31: the publish route rejects with
  `409 slug_conflict` rather than overwriting, and no unique index was added —
  see [`static-site-integration.md` § Publish semantics](static-site-integration.md#publish-semantics).*
- **Auto-publish on generation** ([#53](https://github.com/seopotion/seo/issues/53)), which
  is gated on this model existing but is its own behaviour question.
