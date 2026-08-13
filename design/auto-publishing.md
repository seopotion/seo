# Automatic Publishing

Implemented for [#53](https://github.com/seopotion/seo/issues/53). Automatic publishing is
the final, independent stage of the scheduled content pipeline:

```text
daily scheduler -> generation queue -> image queue -> publish queue -> destination
```

The image worker performs only the durable handoff. After `images_status` is `complete`, it
reloads the article and organization, checks `article_preferences.publishing.auto_publish`,
lists current integrations, initializes one embedded attempt per provider, and sends one
`PublishTask { org_id, article_id, provider }` per provider. A complete-image redelivery
repeats this handoff, so a crash between `completeImages()` and SQS send cannot lose the
publish. Attempt initialization and downstream claims make duplicate messages safe.

If the setting is off, the handoff returns before reading integration credentials. If it is
on but no destination exists, the article remains `generated` and receives the permanent
preflight error `not_connected`. Enabling the setting does not scan old articles; it only
affects image completions and explicit user retries that happen afterward.

## Durable state and claims

`article.auto_publish` is defaulted for historical documents and embeds a bounded attempt
for each supported provider. An attempt has a state (`queued`, `publishing`, `retrying`,
`failed`, `published`, or `cancelled`), attempt count, stable `requested_at`, last-attempt
time, expiring lease, and a normalized safe error. The lease is claimed atomically. An
active lease blocks concurrent delivery; an expired lease can be reclaimed after a worker
crash.

The publish queue has three deliveries and a six-minute visibility timeout around a
five-minute worker. Transient errors are stored as `retrying` and rethrown. Delivery three
stores terminal `failed` before rethrowing to the DLQ. Permanent errors are stored and
acknowledged. The API omits leases but returns attempts, counts, errors, and publications.
`POST /dashboard/articles/{id}/auto-publish/retry` resets failed/cancelled connected targets
and safely emits new tasks without republishing a provider already in `publications[]`.

The worker reloads the article, organization, setting, paid entitlement, and named
integration before claiming. It requires complete images and reads WordPress credentials
only from `Integration.token_enc`. It calls the same provider services as the manual
routes. Each provider is a separate SQS task, so one failure cannot block the other.
`recordPublication()` remains the only lifecycle transition to `published`; the first
successful provider advances the article while other attempt states retain partial
failure information.

## Destination idempotency

WordPress automatic submits explicitly request `publish` and carry the stable SeoPotion
article id as `source_article_id`. Plugin 1.2.0 stores that identity in
`_seo_potion_source_article_id` and stores completion separately in
`_seo_potion_source_publish_complete`. A request must own the source lock before it can
inspect or return a source post. The lock is a MySQL/MariaDB advisory lock owned by the
request's database connection: it has no time-based takeover, active contention returns
retryable `source_publish_in_progress`, and a crashed request becomes recoverable when its
connection closes. Failure to establish the lock fails closed. The new owner may remove and
rebuild an incomplete post, while a completed post is never deleted or recreated. Its
response includes the actual post id, final slug, permalink, and status. The worker requires
both the `idempotent_publish` capability and plugin version 1.2 or newer, plus a live
`publish` response; older plugins fail permanently with `plugin_upgrade_required` without
calling the unsafe submit endpoint. Manual submit still honors the site's draft preference
when no explicit status is sent.

For a normal first static-site publication, the automatic attempt's stable `requested_at`
becomes provider `published_at`; `updated_at` is explicitly null. Attempt time is not reused
as an edit timestamp. The shared manual/automatic publisher holds an expiring integration-level
lease across remote preparation, commit, and `recordPublication()`. Every Git ref retry
reads `manifest.json` from the exact head it will extend, merges remote entries with current
database publications, rechecks source-aware slug ownership, and rerenders the aggregate.
The manifest's `source_article_id` preserves ownership when GitHub accepted a commit before
Mongo recorded it. Recovery reconstructs the source-owned remote entry's exact
`published_at` and nullable `updated_at`, then compares the complete manifest entry and
Markdown bytes. Exact matches record those timestamps and the current head without another
commit. If the article changed after an orphaned first commit, the remote original
`published_at` remains fixed and the durable `article.updated_at` becomes provider
`updated_at` when it is newer than the remote version. If no newer durable edit timestamp
exists, the remote version timestamp is reused as an explicit non-null update marker; this
fallback is stable across both manual and automatic retries. Mongo receives the same
explicit timestamp pair committed remotely, without inferring update state from Date equality.
GitHub tree creation is deterministic; when the desired tree is already the branch head
tree, the client returns the current head commit instead of creating a second commit.
Success records the commit SHA as `ref` and the commit URL as `remote_url`; it does not claim
that a client deployment finished or invent a public article URL. Lease release remains
token-aware and best-effort: a cleanup outage leaves the expiring lease as the fallback and
does not replace the completed result or a specific publishing failure.

Both destinations also reconcile the local crash window: if `recordPublication()` landed
but attempt completion did not, the next delivery marks the attempt `published` directly
from `publications[]` without another remote call.

## Compatibility and rollout

No destructive data migration is required. Article defaults parse historical documents,
and historical publication rows default `remote_url` to null. WordPress connect already
writes the encrypted Integration row. For older mirror-only connections, an enabled image
handoff or explicit retry narrowly encrypts the existing org mirror into an Integration
row before queueing. Manual/admin code may continue using the mirror until #7's contract
phase removes it.

Deployment order is:

1. Ship WordPress plugin 1.2.0 to connected sites that should auto-publish.
2. Deploy the CDK stack to create the publish queue, DLQ, event source, permissions, and
   worker.
3. Deploy the API/image-worker code and then enable automatic publishing for paid/expert
   organizations.

Sites on an older plugin remain safe and actionable: their attempts stop with
`plugin_upgrade_required` rather than risking duplicate posts.
