# Article pipeline CLI — design

**Date:** 2026-08-22
**Status:** approved for planning

## Problem

Testing article publishing on staging is painful: the only trigger for the
generation → images → publish pipeline is the daily EventBridge cron
(07:00 UTC, `GenerationSchedulerFn`). After changing anything about articles,
the next end-to-end run is tomorrow. There is also no operator-friendly way to
inspect where an article is stuck (auto-publish attempt errors live in Mongo).

## Goals

1. **Trigger now:** pull an org's next scheduled article forward and run it
   through the real deployed staging pipeline immediately.
2. **Inspect:** list an org's articles with pipeline state, and show one
   article in full detail (publications, attempt errors).
3. **(Re)publish now:** enqueue publishing for an existing generated article.
4. **Agent-usable:** stable JSON output, machine-readable error codes with
   remediation hints, optional blocking `--wait`, and a checked-in project
   skill so agent sessions discover the workflow cold.

Non-goals: running generation/publishing inline in the CLI process (needs LLM
and fal keys locally; wouldn't test deployed code), bypassing the publish
worker's gates, any new API surface.

## Approach (chosen)

Direct Mongo + direct SQS enqueue from the CLI — the pattern
`db reset-images --enqueue` already established. The CLI writes staging Mongo
(root `.env` `MONGO_URI`) and sends task messages to the staging queues via
env-var queue URLs; the deployed staging worker Lambdas do the actual work, so
a run exercises exactly the code that the nightly cron would.

Rejected: CLI → staging API admin routes (needs an admin-auth story and new
endpoints for an ops-only need); inline pipeline execution (see non-goals).

## Commands

New top-level `articles` group beside `infra` and `db`
(`npm run cli -- articles <cmd>`). All commands follow existing CLI
conventions: `outputOption`/`verboseOption` from `commands/shared.ts`, thin
citty command wrappers over `Result<T>`-returning lib functions, `EXIT` codes,
`emitter` text/JSON rendering, lazy lib imports, `closeDb()` in `finally`,
org targeting via `resolveOrgId` (`--org <id>` XOR `--user <email>`).

### `articles list --org <id> | --user <email>`

One row per article for the org, sorted newest first: article id, title,
`status`, `images_status`, per-provider auto-publish attempt status, providers
present in `publications[]`. Data: `ArticleRepo.listByOrg`.

### `articles show <article-id>`

Full pipeline picture for one article: core fields, `images_status`,
`auto_publish.preflight_error`, every `auto_publish.attempts[]` entry
(provider, status, attempt_count, timestamps, `last_error`), every
`publications[]` entry (provider, ref, slug, remote_url, timestamps), and the
linked planner keyword (id, `scheduled_date`, `generation_status`). Designed
to be polled.

### `articles generate-next --org | --user [--count N] [--wait] [--timeout <sec>]`

Pulls the org's next scheduled article(s) into the pipeline now:

1. Find the org's next planner keyword(s): `article_id: null`,
   `generation_status` not `generated`, attempts under
   `MAX_GENERATION_ATTEMPTS`, smallest `scheduled_date` first. `--count`
   defaults to 1.
2. For each, bump `scheduled_date` to today (`KeywordRepo.reschedulePending`)
   so the pick is consistent with scheduler semantics and visible in the
   planner.
3. Enqueue a `GenerateTask` (`@shared/schemas`) to `GENERATION_QUEUE_URL`,
   using the CLI's own `SQSClient` honoring `SQS_ENDPOINT` (same as
   `lib/images.ts`) — no dependency on `apps/api`.
4. Output: keyword id(s), title, old→new scheduled_date, queue message id.

No due keyword ⇒ `NO_KEYWORDS_DUE` error (hint: check the planner /
strategy commands).

### `articles publish <article-id> [--provider wordpress|static-site] [--wait] [--timeout <sec>]`

Mirrors the API's auto-publish retry route
(`POST /dashboard/articles/{id}/auto-publish/retry`):

1. Load article + org + integrations.
2. **Precondition checks (fail fast, before enqueueing)** — the publish
   worker silently drops gated tasks, so the CLI must catch these first:
   - `IMAGES_INCOMPLETE` — `images_status !== 'complete'` (hint:
     `db reset-images`)
   - `AUTO_PUBLISH_DISABLED` — org preset
     `article_preferences.publishing.auto_publish` is off
   - `ORG_NOT_PAID` — `isPaid(org)` false (hint: `db set-plan`)
   - `NOT_CONNECTED` — no connected integration for the requested
     provider(s)
3. Target providers: `--provider` if given, else all connected providers.
   Skip providers already in `publications[]` or with a `published` attempt
   (reported as skipped, not an error).
4. Per target provider: reset a failed/cancelled attempt
   (`ArticleRepo.resetAutoPublishAttempt`) or initialize one
   (`initializeAutoPublishAttempt`), then enqueue a `PublishTask` to
   `PUBLISH_QUEUE_URL`.
5. Output: per-provider action taken (enqueued / skipped-published /
   skipped-in-flight).

### `--wait` semantics

Optional on `generate-next` and `publish`; polls Mongo (~5 s interval) until a
terminal state or timeout:

- `generate-next`: terminal when the keyword's article exists **and** each
  connected provider's attempt reaches `published`/`failed`/`cancelled` (or
  `preflight_error` is set, or generation itself fails —
  `generation_status: 'failed'` at attempt cap). Default `--timeout 900`.
- `publish`: terminal when every enqueued provider's attempt reaches
  `published`/`failed`/`cancelled`. Default `--timeout 360` (publish worker
  timeout is 5 min).

On timeout: exit `OP_FAILED` with the last observed state in the payload —
never claim success. On terminal failure: surface `last_error` /
`preflight_error` verbatim.

## Agent ergonomics

- `--output json`: JSONL progress events on stderr, single JSON object on
  stdout (existing emitter). All failures carry a stable `code` from the list
  above plus the existing `BAD_TARGET`/`ORG_NOT_FOUND`/etc., and a `hint`
  string with the remediation command where one exists.
- Exit codes: `SUCCESS 0`, `USER_ERROR 1` (bad args / precondition codes),
  `INFRA_DOWN 2` (Mongo/SQS unreachable), `OP_FAILED 3` (pipeline reported
  failure or `--wait` timeout), `INTERNAL 4`.
- Env requirements are validated up front with explicit errors:
  `MONGO_URI` (root `.env`), `GENERATION_QUEUE_URL` / `PUBLISH_QUEUE_URL` for
  the enqueueing commands, AWS credentials (ambient) unless `SQS_ENDPOINT`
  (local ElasticMQ) is set. Commands that write emit the existing
  "which env does MONGO_URI target" warning.

## Project skill

`.claude/skills/article-pipeline/SKILL.md` — the repo's first checked-in
skill, so cold-start agent sessions discover the workflow. Contents:

- **When to use:** verifying article generation/publishing changes on staging
  (or locally against ElasticMQ) without waiting for the nightly cron.
- **Setup:** required env vars and where they come from; the
  `npm run --silent cli -- … --output json` invocation form (npm banner
  corrupts stdout JSON otherwise).
- **Workflow:** `articles generate-next --user <email> --wait` →
  `articles show <id>` → optionally `articles publish <id>`; what each error
  code means and its remediation; the worker gates that must hold
  (auto_publish preset, paid plan, images complete, integration connected).
- **Caveats:** local `.env` targets the staging DB (writes are live); fal key
  invalid locally so image steps only run on staging.

## Implementation shape

- `apps/cli/src/commands/articles.ts` — citty wrappers (4 subcommands).
- `apps/cli/src/lib/articles.ts` — lib functions returning `Result<T>`:
  `listArticles`, `showArticle`, `generateNext`, `publishArticle`, plus the
  shared wait/poll helper.
- `apps/cli/src/types.ts` — new result data shapes + error codes.
- Reuses: `@shared/db` repos, `@shared/schemas` (`GenerateTask`,
  `PublishTask`, `isPaid` from `org.ts`), `resolveOrgId`, emitter.
- No changes to worker, API, or infra. No new npm dependencies.

## Testing

Vitest, following existing CLI test patterns (`apps/cli/tests/*.test.ts`):

- `articles.test.ts` — lib functions with `vi.mock('@shared/db')` and a
  mocked SQS client: happy paths, each precondition code, provider skipping,
  `NO_KEYWORDS_DUE`, wait terminal/timeout paths (fake timers).
- `cli-smoke.test.ts` — extend to cover `articles --help` and subcommand
  registration.
- Manual verification on staging: run `generate-next --wait` for a test org
  and confirm the article publishes.

Definition of done: `npm run lint`, `npm run check:all`, `npm test` green;
skill file present; PROGRESS.md line + issue reference per repo workflow.
