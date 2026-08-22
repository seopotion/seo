---
name: article-pipeline
description: Use when testing or debugging article generation/publishing on staging (or against local ElasticMQ) — trigger the pipeline now instead of waiting for the daily 07:00 UTC cron, inspect where an article is stuck, or (re)publish an article, all via the seo-dev CLI.
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
3. As an agent, always use JSON output, and always through
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
| `articles publish <article-id> [--provider wordpress\|static-site] [--wait] [--timeout <sec>]` | Reset failed attempts and enqueue publishing for an existing article |

Typical loop: `generate-next --wait` → read the wait report → `show <id>`
for detail → `publish <id>` if you changed something and want to republish.

`--wait` polls Mongo every 5s and exits 3 (`OP_FAILED`) on timeout or a
terminal failure — the payload always carries the last observed state.
Exit codes: 0 ok, 1 user error (incl. unmet gates), 2 infra/auth down,
3 pipeline failed or timed out, 4 internal.

## Error codes and remediation

| Code | Meaning / fix |
| --- | --- |
| `AWS_NOT_AUTHENTICATED` | AWS creds missing/expired — `aws sso login` |
| `SQS_UNAVAILABLE` | Bad queue URL or network — check the URL / VPN |
| `QUEUE_URL_MISSING` | Set `GENERATION_QUEUE_URL` / `PUBLISH_QUEUE_URL` |
| `NO_KEYWORDS_DUE` | Planner has nothing ungenerated — `db strategy-audit` / `db strategy-run` |
| `IMAGES_INCOMPLETE` | Images not done — `articles show`, maybe `db reset-images --enqueue` |
| `AUTO_PUBLISH_DISABLED` | Org preset off — enable auto-publish in dashboard settings |
| `ORG_NOT_PAID` | `npm run cli -- db set-plan --org <id> --plan paid` |
| `NOT_CONNECTED` | No integration row for the provider — connect it in the dashboard |

The publish worker re-checks all of these gates and **silently drops**
tasks that fail them — which is why the CLI checks first. If an enqueued
task seems to vanish, check `articles show` for the attempt state and
`last_error`.

## Caveats

- Generation spends real LLM + image credits; publish pushes to the org's
  LIVE connected destination (WordPress site / GitHub repo).
- The local `FAL_KEY` is invalid — image steps only work via the deployed
  staging workers, not any local worker.
- An org still on the legacy WordPress token (no `integrations` row) reads
  as `NOT_CONNECTED` here; publishing once from the dashboard migrates it.
