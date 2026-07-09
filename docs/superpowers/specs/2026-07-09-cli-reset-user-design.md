# `db reset-user` — CLI command design

**Date:** 2026-07-09
**Status:** Approved

## Purpose

Frontend developers need to re-run onboarding while developing. Onboarding is
gated on the logged-in user having no org, so "resetting" a user means deleting
their orgs and all org-scoped data. The user document stays; next login goes
straight to onboarding.

## Command

```
npm run cli -- db reset-user --user <email> [--output json|text] [--verbose]
```

User-only targeting (no `--org`): resetting is inherently user-scoped.

## Behavior

`resetUser({ user })` in `apps/cli/src/lib/db.ts`, following the existing
`setOrgPlan` Result contract:

1. `UserRepo.findByEmail(email)` — missing user → `fail('USER_NOT_FOUND', …)`.
2. `OrgRepo.findByUserId(user.id)` — zero orgs is **success** with zero counts
   (idempotent).
3. For each org: `deleteMany({ org_id })` on `keywords`, `candidates`,
   `articles` via new repo methods, then delete the org doc. Scan results are
   embedded in the org, so they go with it.
4. Result data: deleted counts per collection plus deleted org ids.
5. `closeDb()` in `finally`, like the other lib functions.

The command handler in `apps/cli/src/commands/db.ts` mirrors `set-plan`:
same emitter steps, the same "applies to whatever MONGODB_URI targets — never
run this against prod" warning, exit `SUCCESS` / `USER_ERROR`.

## New repo methods (`@shared/db`)

Thin wrappers matching existing repo style:

- `KeywordRepo.deleteByOrgId(orgId)` → deleted count
- `CandidateRepo.deleteByOrgId(orgId)` → deleted count
- `ArticleRepo.deleteByOrgId(orgId)` → deleted count
- `OrgRepo.deleteById(id)` → boolean (matched)

## Rejected alternatives

- **Raw `deleteMany` from the CLI lib** — violates the "app code calls
  repositories, never the driver" convention.
- **Also deleting the user document** — unnecessary; login recreates it via
  `upsertByGoogleSub` and the onboarding gate is org-presence.
- **Generic `db wipe --collection`** — flexibility nobody asked for.

## Testing

Unit tests in `apps/cli/tests/db.test.ts` alongside the `setOrgPlan` tests
(mocked repos):

- user not found → `USER_NOT_FOUND`
- user with no orgs → success, zero counts
- happy path: one org, data deleted across all three collections + org
- multi-org user: **all** orgs wiped (no ambiguity error — we delete everything)
