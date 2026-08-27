---
name: article-pipeline
description: Use when testing or debugging article generation/publishing on staging (or against local ElasticMQ) — trigger the pipeline now instead of waiting for the daily 07:00 UTC cron, inspect where an article is stuck, publish an article — or repair existing articles (dead image CDN URLs, dead internal links, a missing static-site post URL base), all via the seo-dev CLI.
---

# Article pipeline via the seo-dev CLI

The only automatic trigger for generate → images → publish is the daily
07:00 UTC EventBridge cron. The `articles` CLI group triggers and inspects
that pipeline on demand. The CLI only reads/writes Mongo and enqueues SQS
tasks — the **deployed workers** for the targeted environment do the real
work, so a run exercises the deployed code.

## Setup

1. **Check AWS login first**: `aws sts get-caller-identity`. If it fails,
   `aws sso login` (or fix `AWS_PROFILE`). The CLI also preflights this and
   fails with `AWS_NOT_AUTHENTICATED` before writing anything.
2. Env vars:
   - `MONGO_URI` — comes from the root `.env`. **It usually points at the
     staging database — writes are live.**
   - `GENERATION_QUEUE_URL` / `PUBLISH_QUEUE_URL` — the target env's queue
     URLs; find them with `aws sqs list-queues`. For local dev set
     `SQS_ENDPOINT=http://localhost:9324` and the ElasticMQ queue URLs
     instead.
3. The CLI loads `./.env` from the **cwd** (`--env-file-if-exists=.env`) — run
   it from the main checkout root; a worktree without `.env` has no config.
4. As an agent, always use JSON output, and always through
   `npm run --silent cli` — plain `npm run` prints a banner to stdout that
   corrupts the JSON payload:

   ```bash
   npm run --silent cli -- articles list --user someone@example.com --output json
   ```

## Commands

| Command | What it does |
| --- | --- |
| `articles list --org <id>\|--user <email> [--limit N]` | One row per article: status, images_status, attempt states, published providers |
| `articles show <article-id>` | Full detail: publications, attempt errors, preflight error, planner keyword. Pollable |
| `articles generate-next --org\|--user [--count N] [--wait] [--timeout <sec>]` | Enqueue the next ungenerated planner keyword(s) — runs the whole pipeline now |
| `articles publish <article-id> [--provider wordpress\|static-site] [--wait] [--timeout <sec>]` | First publish / retry: reset failed attempts and enqueue publishing. Providers already in `publications` are **`skipped_published`** — it never re-pushes content |

Typical loop: `generate-next --wait` → read the wait report → `show <id>`
for detail → `publish <id>` if publishing failed or never ran.

**Republishing an already-published article is not a CLI operation.** `articles
publish` skips it and the publish worker only *reconciles* an existing
publication. Re-push changed content from the dashboard (per-article publish
button → static-site `POST /dashboard/articles/{id}/publish` commits an update;
WordPress `PUT /dashboard/articles/{id}/wordpress`) or the admin panel's article
editor (save + WordPress publish/update). Both require `images_status: complete`.

`--wait` polls Mongo every 5s and exits 3 (`OP_FAILED`) on timeout or a
terminal failure — the payload always carries the last observed state.
Exit codes: 0 ok, 1 user error (incl. unmet gates), 2 AWS/SQS preflight
failed, 3 pipeline failed or timed out, 4 internal (incl. Mongo connection
failures).

## Error codes and remediation

| Code | Meaning / fix |
| --- | --- |
| `AWS_NOT_AUTHENTICATED` | AWS creds missing/expired — `aws sso login` |
| `SQS_UNAVAILABLE` | Bad queue URL or network — check the URL / VPN |
| `QUEUE_URL_MISSING` | Set `GENERATION_QUEUE_URL` / `PUBLISH_QUEUE_URL` |
| `NO_KEYWORDS_DUE` | Planner has nothing ungenerated — see the **strategy-pipeline** skill (`db strategy-audit` first; `db strategy-run [--force]` to build one) |
| `IMAGES_INCOMPLETE` | Images not done — check `articles show`; a failed image run can be replayed from the admin panel (`POST /admin/v0/articles/{id}/images`, operator JWT) |
| `AUTO_PUBLISH_DISABLED` | Org preset off — enable auto-publish in dashboard settings |
| `ORG_NOT_PAID` | `npm run cli -- db set-plan --org <id> --plan paid` |
| `ORG_NOT_FINALIZED` | Org has no presets — finish onboarding for it first (`generate-next` only) |
| `NOT_CONNECTED` | No integration row for the provider — connect it in the dashboard |

The publish worker re-checks all of these gates. When one fails, it
consumes the task and records a typed failure on the attempt rather than
retrying — visible via `articles show` as `last_error`. The CLI checks
these gates first to avoid burning an attempt and to give an immediate,
actionable error instead of waiting on the worker.

## Repairing existing articles

Three `db` commands fix articles in place. All read/write whatever `MONGO_URI`
targets; the two destructive ones are **dry run by default — add `--apply`**.
None of them republish: after `--apply`, re-push every published article they
touched (see "Republishing" above), or the customer's site keeps the old content.

| Command | What it does | Follow-up |
| --- | --- | --- |
| `db set-post-base --org <id> --base <https://site/blog>` | Sets `post_url_base` on the org's static-site integration (#228); a post lives at `<base>/<slug>`. Trailing slash stripped; `INVALID_BASE` for non-http(s)/query/fragment; `NO_STATIC_SITE` if none | Run **before** `clean-links` — it derives the allowed static-site URLs from this |
| `db clean-links --org <id> [--apply]` | Unwraps every internal link that isn't a verified (HTTP-checked from your machine), published page of the org (#186), using the pipeline's own sanitizer. Scans all articles, any status. Result lists `publishedChanged` | Republish each `publishedChanged` article |
| `db reset-images --host <dead-cdn-host> --org <id>\|--article <id> [--apply] [--enqueue]` | For image slots whose URL is on that host: blanks the slot (+ inline markdown + `featured_image_url`), rewinds `images_status` so the image worker refills them. `--enqueue` (needs `--apply` and `IMAGES_QUEUE_URL` + AWS auth) requeues the image task | Wait until `articles show` reports `images_status: complete` (regeneration bills fal and produces **different** images), then republish |

Order for a multi-part repair: `set-post-base` → `reset-images --apply --enqueue`
→ wait for images → `clean-links` (verification needs the pages live, so run it
once the site is healthy) → one republish pass.

Traps:
- `clean-links` dry run showing `allowedUrls: 0` with `published > 0` means
  verification failed (wrong base, site down, WAF) and `--apply` would strip
  **every** internal link — investigate instead.
- `reset-images --apply` without `--enqueue` leaves articles at `pending`; a
  rerun finds no dead URLs and is a no-op. Replay them from the admin panel
  (`POST /admin/v0/articles/{id}/images`) instead. Same outcome if `--enqueue`
  fails mid-way (`RESET_IMAGES_FAILED`): unlike `generate-next`/`publish` it
  has **no AWS/SQS preflight** and blanks Mongo before sending — make sure
  `IMAGES_QUEUE_URL` is the target env's queue (`.env.example` has the local
  ElasticMQ one) and AWS auth is fresh *before* `--apply --enqueue`.
- The dead host is whatever the build/404 names, e.g. `dXXXX.cloudfront.net`;
  the pre-2026-08-12 account move is the usual cause (`infra/ENVIRONMENTS.md`).

## Caveats

- Generation spends real LLM + image credits; publish pushes to the org's
  LIVE connected destination (WordPress site / GitHub repo).
- The local `FAL_KEY` is invalid — image steps only work via the deployed
  staging workers, not any local worker.
- An org still on the legacy WordPress token (no `integrations` row) reads
  as `NOT_CONNECTED` here; publishing once from the dashboard migrates it.
