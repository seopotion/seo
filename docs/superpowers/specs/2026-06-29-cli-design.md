# Design: seo-dev management CLI (`@seo/cli`)

_Date: 2026-06-29_

## Summary

A management CLI for the seo-dev monorepo, modeled on the dkn-harbor CLI pattern
(`citty` + structured `Result` + dual-mode `Emitter` + exit codes). It serves two
audiences from one tool: humans (readable text output) and AI agents (JSON output
+ machine-readable exit codes).

**v1 scope is intentionally small:** local dev / infra ops. Two commands —
`infra check` and `db init`. The architecture leaves clean room for deferred
command groups (E2E scan harness, data/admin management) without rework.

## Goals

- One tool for local dev/ops, replacing loose npm scripts (e.g. `db:init`).
- First-class **agent automation surface**: `--output json` emits structured
  progress events + a final JSON result, and every command sets a meaningful
  exit code.
- A layered structure that absorbs future commands (`e2e`, `db reset`/`seed`,
  `org`/`user` admin) as new `commands/*` + `lib/*` pairs.

## Non-goals (v1)

- E2E scan pipeline harness — deferred (documented slot only).
- Data/admin management (orgs, users, presets CRUD) — deferred.
- Destructive db operations (`reset`, `drop`, `seed`) — deferred.
- Auth/session handling — none of the v1 commands need it.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Placement | `apps/cli` workspace | Matches existing glob `apps/*` (globs are `['packages/shared/*','apps/*']`); CLI is an app-like runnable leaf, not a shared lib. Zero workspace-config change. |
| Runtime | `tsx` / Node | Matches seo-dev's existing dev entrypoints, Vitest, Biome. (dkn-harbor uses bun; we adapt.) |
| Framework | `citty` | The pattern the CLI is modeled on; nested `subCommands`, shared arg spreads. |
| Client layer | reuse `@shared/db` | Repositories + `getDb`/`ensureIndexes` already exist; no separate `clients/`. |

## Architecture

### Workspace wiring

- New workspace **`apps/cli`**, package name **`@seo/cli`**.
- Dependencies: `@shared/db` `"*"`, `@shared/types` `"*"`,
  `@aws-sdk/client-sqs` (SQS ping), `citty`. `tsx` is already a root devDep.
- Entry `apps/cli/src/index.ts` — shebang (`#!/usr/bin/env tsx`), defines the
  citty `main` command with `subCommands`, calls `runMain(main)`.
- Root `package.json` script: **`"cli": "tsx apps/cli/src/index.ts"`**, invoked
  as `npm run cli -- <command> [options]`.

### Layout

```
apps/cli/
  package.json          # @seo/cli, type:module, deps + (no bin)
  src/
    index.ts            # citty main + subCommands (infra, db)
    types.ts            # Result<T>, ok/fail, EXIT, Emitter, OutputMode, data types
    utils/
      emitter.ts        # createEmitter(mode): text vs json
    commands/
      shared.ts         # outputOption, verboseOption spreads
      infra.ts          # `infra check`
      db.ts             # `db init`
    lib/
      infra.ts          # checkInfra(services?) -> Result<InfraCheckResult>
      db.ts             # initDb() -> Result<DbInitData>
  tests/                # vitest only discovers apps/**/tests/**/*.test.ts
    emitter.test.ts
    infra.test.ts
    db.test.ts
    cli-smoke.test.ts   # spawns the CLI; --help lists both command groups
```

No per-app `tsconfig.json`: the root `tsconfig.json` already includes
`apps/*/src/**` and `apps/*/tests/**`, so `npm run check` covers the CLI (same
as `apps/worker`).

**Layering rule:** `commands/` are thin citty definitions that parse args,
create an emitter, lazy-`import()` the matching `lib/` function, render the
`Result`, and `process.exit()` with the right code. All real logic + tests live
in `lib/`. `@shared/db` is the client layer.

## Output & result contract

This is the spine that makes the CLI agent-drivable.

```ts
interface CliError { code: string; message: string; suggestion?: string }
type Result<T> = { ok: true; data: T } | { ok: false; error: CliError }
const ok   = <T>(data: T): Result<T> => ({ ok: true, data })
const fail = (code, message, suggestion?): Result<never> =>
  ({ ok: false, error: { code, message, suggestion } })

const EXIT = { SUCCESS: 0, USER_ERROR: 1, INFRA_DOWN: 2, OP_FAILED: 3, INTERNAL: 4 } as const
type OutputMode = 'text' | 'json'
```

- Every `lib/` function returns `Result<T>`.
- Commands translate a `Result` into output via the `Emitter` and exit with an
  `EXIT` code.

### Emitter

`createEmitter(mode: OutputMode): Emitter` with methods
`step / info / warn / error / result`.

- **text** (humans): progress (steps, icons) to **stderr**; final result
  pretty-printed to **stdout**. On error, `Error [CODE]: message` + optional
  `Suggestion:` to stderr.
- **json** (agents): each progress event as a JSONL object on **stderr**
  (`{ type: 'step:start'|'step:done'|'step:fail'|'info'|'warn'|'error', ... }`);
  a single final JSON object on **stdout** — `data` on success, `{ error }` on
  failure.

stdout carries only the final machine-readable result; stderr carries
human/agent progress. Agents parse stdout and read the exit code.

### Global options

Via `commands/shared.ts` spreads:
- `--output text|json` (default `text`)
- `--verbose` / `-v` (default `false`)

## Commands (v1)

### `infra check [--services mongo,sqs,api]`

Checks local infrastructure health. Default checks all three; `--services`
filters to a comma-separated subset (invalid value → `USER_ERROR`).

- **mongo** — `getDb()` then `db.command({ ping: 1 })`.
- **sqs** — `GetQueueAttributes` on `SCAN_QUEUE_URL`, honoring `SQS_ENDPOINT`
  (ElasticMQ locally).
- **api** — `GET {API_URL:-http://localhost:8787}/health`, expect `200`.

Each service reports `{ service, available, latencyMs?, error? }`. In text mode,
renders a per-service table before the result. Exit `INFRA_DOWN` if any checked
service is down, else `SUCCESS`.

### `db init`

Runs `ensureIndexes()` from `@shared/db` (replaces `npm run db:init`). Returns
the set of collections/indexes ensured. Exit `OP_FAILED` on error, else
`SUCCESS`.

## Error handling

- Expected failures (infra down, bad input, op failure) → `fail(code, …)` →
  mapped to `USER_ERROR` / `INFRA_DOWN` / `OP_FAILED`.
- Unexpected throws in a command handler → caught, emitted as `INTERNAL`, exit
  `INTERNAL`.
- `lib/` functions never call `process.exit` or print — they return `Result`.
  Only `commands/` do I/O and exit. This keeps `lib/` unit-testable.

## Testing

- **Vitest**, in `apps/cli/tests/` (the only place `npm test` discovers):
  - `emitter.test.ts` — json `result()` writes a single JSON object to stdout;
    text `result()` of a failure writes the `[CODE]` line to stderr.
  - `infra.test.ts` — `checkInfra` with `@shared/db`, the SQS client, and
    `fetch` mocked (mirror existing `vi.mock` / `vi.hoisted` patterns); cover
    all-up, one-down, and `--services` filtering.
  - `db.test.ts` — `initDb` calls `ensureIndexes` (mocked) and maps a thrown
    error to a `fail(...)` Result.
- **Smoke**: `cli-smoke.test.ts` — spawns the CLI with `--help` via the local
  `tsx` binary; asserts exit 0 and that output lists both `infra` and `db`.
- `apps/cli` is covered by the root `npm run check` (root tsconfig include) and
  by `npm test` (vitest `apps/**/tests/**` glob).
- Always-green gates unchanged: `npm run lint`, `npm run check`, `npm test`.

## Future slots (documented, not built)

| Group | Commands | Hangs off |
|---|---|---|
| E2E harness | `e2e scan` (start_scan → SQS → worker → presets → details) | `commands/e2e.ts` + `lib/e2e/*` |
| DB admin | `db reset`, `db seed` | `commands/db.ts` + `lib/db.ts` |
| Data admin | `org list/get`, `user list/get`, setup status advance | `commands/org.ts`, `commands/user.ts` + libs |

Each is a new thin command + a `lib/` function returning `Result<T>`; the
emitter, exit codes, and output contract already support them.
