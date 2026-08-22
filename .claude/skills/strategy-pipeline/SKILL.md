---
name: strategy-pipeline
description: Use when an org's 30-day keyword plan looks wrong or thin, the planner has no entries (`NO_KEYWORDS_DUE` from `articles generate-next`), a strategy run failed, or you're iterating on the keyword pipeline (`@shared/keywords` / `@shared/strategy`) for a real org — via the seo-dev CLI `db strategy-audit / strategy-dryrun / strategy-run`.
---

# Strategy (30-day plan) via the seo-dev CLI

The strategy job builds an org's candidate keyword pool and schedules the
30-day planner. Deployed, it is a Step Functions state machine over a
Mongo-checkpointed `strategy_runs` doc (stages gather → enrich → triage →
serp_fetch → plan → persist); launched once per org by `POST /setup/finalize`
(orgs paid at finalize time) or later by `db set-plan` / the admin panel. Since
#211 a **short plan is the intended outcome** when few candidates survive
SERP validation + relevance + volume/KD — the job under-fills rather than
backfilling junk. So "thin plan" questions are "why did the pool shrink?".

## Conventions

- Agents: `--output json` via `npm run --silent cli -- db …` (plain `npm run`
  prints a banner into stdout and corrupts the JSON). Text mode renders a
  multi-table report instead.
- The CLI loads `./.env` from the **cwd** (`--env-file-if-exists=.env`) — run it
  from the main checkout root, not a worktree without `.env`. `MONGO_URI` there
  usually points at **live staging**.
- Live runs need `DATAFORSEO_LOGIN/PASSWORD` + `OPENROUTER_API_KEY` in `.env`
  (`PROVIDER_CREDENTIALS_MISSING` otherwise). No AWS needed — everything here
  runs in-process.
- Exit codes: 0 ok, 1 user error, 4 internal.

## The loop

| Step | Command | Costs / persists |
| --- | --- | --- |
| 1. Diagnose | `db strategy-audit --org <id>\|--user <email> [--keyword a,b]` | Mongo reads only. Prints `strategy_status`, pool histograms (relevance, volume, KD, source), the scheduled plan, diagnostics: `backfill_count`, `relevance_exact_zero` (high ⇒ truncated/re-cased LLM echo, not real irrelevance), `kd_zero_scheduled`, pool-vs-plan source shares; notes when `competitors` is empty (disables the ranked_keywords branch). `--keyword` dumps matching candidate records. Pool = union of all runs → approximate after a rerun |
| 2. Record one live run | `db strategy-dryrun --org <id> --snapshot ./snap.json [--serp-top-n N] [--seeds a,b]` | Real DataForSEO (up to `serpTopN`=150 SERP calls, the dominant cost — cap with `--serp-top-n`) + a few dozen batched LLM calls. **Persists nothing in Mongo**; writes the snapshot. The seed LLM call swings the pool ±40% — pin `--seeds` for any A/B |
| 3. Iterate free | `db strategy-dryrun --replay ./snap.json` | Zero network calls; org is implied by the snapshot. Edit `packages/shared/keywords/*` (config thresholds, filters, scoring, plan selection) and replay. `--allow-live-misses` fetches only calls the snapshot lacks (e.g. new seeds / `--model-*`) and rewrites it |
| 4. Recover | `db strategy-run <org-id>` | REAL: persists candidates, schedules planner entries, writes `strategy_runs`, spends credits — in-process with local creds. Tops up: dedupes against existing planner keywords and fills only `30 − already_scheduled`. Then `articles generate-next` (see the article-pipeline skill) |

Dry run models a *fresh* org (`existing_keywords: []`), so its "PLAN N of 30" is
not exactly what a top-up rerun would schedule.

## Gotchas (verified in code)

- **`strategy-run` on a `completed` org schedules nothing.** The persist
  stage short-circuits when `org.strategy_status === 'completed'`
  (`packages/shared/strategy/src/persist.ts`) and the CLI has no `--force` or
  status reset — you burn the full pipeline's credits for nothing (and leave
  a stray `strategy_runs` doc that muddies later audits). Check
  `strategy_status` in the audit first. For a completed org use the admin
  force-rerun (admin panel "strategy force-rerun", or
  `POST /admin/orgs/{id}/strategy {"force":true}`), which resets the status to
  `failed`, reclaims, and runs it on the **deployed** Step Functions. Use
  `strategy-run` for `failed`/`none` orgs, or when you need the run to use
  *local* (unmerged) pipeline code.
- `strategy-run` is not guarded by `claimStrategy` — it will happily start a
  second run next to a `pending` one. Don't.
- No CLI lever removes thin/junk planner entries before a rerun; a rerun tops
  up, it doesn't replace. Unschedule via the admin panel, or (nuclear)
  `db delete-org` (staging-accounts skill).
- `ORG_NOT_FINALIZED` — org has no presets; the job would skip it. Finish
  onboarding first.
- `--snapshot` and `--replay` are mutually exclusive; `--allow-live-misses`
  only with `--replay` (`BAD_ARGS`).
