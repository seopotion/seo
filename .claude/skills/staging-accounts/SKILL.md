---
name: staging-accounts
description: Use when a test user on staging (or local Mongo) needs onboarding re-run, the paywall bypassed (plan set to paid/expert), or junk test orgs/users purged — via the seo-dev CLI `db set-plan / reset-user / delete-user / delete-org`.
---

# Test accounts on staging via the seo-dev CLI

These `db` commands act on **whatever `MONGO_URI` targets** — the root `.env`
usually points at the **live staging database**, so every `--apply` is a real
write. None of them touch prod guards; never point them at prod.

## Conventions

- Agents: `--output json` via `npm run --silent cli -- db …` (plain `npm run`
  prints a banner into stdout and corrupts the JSON).
- The CLI loads `./.env` from the **cwd** (`--env-file-if-exists=.env`) — run it
  from the main checkout root; a worktree without `.env` has no `MONGO_URI`
  and exits 4.
- Target an org with `--org <id>` **or** `--user <email>` (owner's single org;
  `AMBIGUOUS_ORG` if they own several → pass `--org`). `delete-org` takes ids only;
  `reset-user`/`delete-user` take an email only.
- Exit codes: 0 ok, 1 user error, 4 internal (Mongo down etc.).

## Commands

| Command | Effect | Dry run? |
| --- | --- | --- |
| `db set-plan --org\|--user [--plan free\|paid\|expert]` (default `paid`) | Sets `org.plan`. **If the org is finalized** (`setup_complete` + presets) and the plan is paid/expert, it also claims and **runs the 30-day strategy job** — in-process from your machine when `STRATEGY_STATE_MACHINE_ARN` is unset | no |
| `db reset-user --user <email>` | Deletes the user's orgs + keywords, candidates, articles, GSC connections, subscriptions (cancelling active LemonSqueezy subs first). User doc stays → next login re-runs onboarding | **no** |
| `db delete-user --user <email>` | `reset-user` + deletes the user document | **no** |
| `db delete-org --org <id>[,<id>…] \| --keep <id>[,…] [--apply]` | Deletes the orgs and *every* org-scoped doc (the `reset-user` set plus integrations, strategy runs, GSC cache). Users and the append-only `admin_actions` log are untouched. `--keep` inverts: delete every org **except** these — an unknown id in either list aborts the whole sweep | yes (default) |

Typical flows:

```bash
# re-test onboarding: wipe the account's orgs, then log in again in the dashboard
npm run --silent cli -- db reset-user --user tester@example.com --output json

# after onboarding finished: bypass the paywall (this launches the strategy run — see below)
npm run --silent cli -- db set-plan --user tester@example.com --plan paid --output json

# purge load-test orgs: preview, then apply
npm run --silent cli -- db delete-org --org <id1>,<id2> --output json
npm run --silent cli -- db delete-org --org <id1>,<id2> --apply --output json
```

## Gotchas (all verified in code)

- **`set-plan` is not just a flag flip — decide *when* to run it.** The
  strategy job is launched once, by whoever first sees the org paid + finalized:
  - `set-plan` **before** finalize (after `start_scan`): `POST /setup/finalize`
    on the deployed API launches it on Step Functions. Simplest for staging.
  - `set-plan` **after** finalize: the CLI launches it itself via
    `launchStrategy(…, { wait: true })`. Without `STRATEGY_STATE_MACHINE_ARN`
    in `.env` that runs the whole keyword pipeline **locally**: needs
    `DATAFORSEO_LOGIN/PASSWORD` + `OPENROUTER_API_KEY`, blocks until done, spends
    real credits. If it fails → `STRATEGY_ENQUEUE_FAILED`, plan is set,
    `strategy_status` reverts to `failed`, org is paid but dormant; re-run
    `set-plan` (or `db strategy-run`, strategy-pipeline skill) to retry.
  It only fires once (`claimStrategy` from `none|failed`), so re-running on an
  org that already has a run is safe.
- **Paid ≠ auto-publish.** Publishing also needs the preset
  `article_preferences.publishing.auto_publish = true` (default false; set in
  the dashboard) and a connected provider (`integrations` row).
- **`reset-user` leaves orphans**: it predates `integrations`, `strategy_runs`
  and `gsc_analytics_cache` and does not delete them. Harmless for re-onboarding
  (new org = new id), but for a clean DB find the org id first
  (`articles list --user …` returns `org_id`) and use `db delete-org --apply`.
- **`SUB_CANCEL_FAILED`** → an org has an active LemonSqueezy sub and
  `LEMONSQUEEZY_API_KEY` is unset (or the cancel call failed). Nothing was
  deleted. Set the key for the targeted env or cancel in the LS dashboard.
- Deletes are hard deletes of Mongo rows only: content already pushed to a
  WordPress site / GitHub repo, S3 images, and in-flight SQS / Step Functions
  work are not cleaned up.
- Billing webhooks (`apply-event.ts`) call `setPlan` too — a real subscription
  event on the org can overwrite the override.

## Error codes

| Code | Fix |
| --- | --- |
| `BAD_TARGET` | Exactly one of `--org` / `--user` (or `--org` / `--keep` for delete-org) |
| `USER_NOT_FOUND` / `ORG_NOT_FOUND` | Typo, or wrong `MONGO_URI` |
| `AMBIGUOUS_ORG` | User owns several orgs — pass `--org <id>` |
| `INVALID_PLAN` | `free`, `paid` or `expert` |
| `STRATEGY_ENQUEUE_FAILED` | Plan was set; strategy launch failed — see gotchas |
| `SUB_CANCEL_FAILED` | See gotchas; nothing deleted |
