# `db reset-user` CLI Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `npm run cli -- db reset-user --user <email>` which deletes a user's orgs and all org-scoped data (keywords, candidates, articles) so the next login re-runs onboarding. The user document stays.

**Architecture:** Three layers, mirroring the existing `db set-plan` command: (1) thin delete methods on the `@shared/db` repositories, (2) a `resetUser` function in `apps/cli/src/lib/db.ts` returning the CLI's `Result<T>` contract, (3) a citty subcommand in `apps/cli/src/commands/db.ts` that translates the Result into emitter output + exit codes.

**Tech Stack:** TypeScript, citty (CLI), mongodb driver 7 (via repositories only), Vitest (unit tests mock `@shared/db` with `vi.mock`/`vi.hoisted`; repo integration tests hit real Mongo via docker compose).

**Spec:** `docs/superpowers/specs/2026-07-09-cli-reset-user-design.md`

## Global Constraints

- App code calls repositories, never the mongodb driver directly (CLAUDE.md data-layer rule). Tests may use the raw driver for fixtures/assertions.
- Biome formatting: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after writing code.
- `verbatimModuleSyntax` is on: use `import type` for type-only imports.
- Never connect/close Mongo in repo methods — the client is cached at module scope; the CLI lib closes via `closeDb()` in `finally`.
- Before claiming done: `npm run lint`, `npm run check:all`, `npm test` must all pass.
- Unit tests (`npm test`) need no infra. Integration tests need `docker compose up -d mongo` first.
- Commit messages use the `[area]` prefix convention (`[db]`, `[cli]`) and end with the trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Repository delete methods

**Files:**
- Modify: `packages/shared/db/src/repositories/org.repo.ts` (append method inside the `OrgRepo` object, after `setPlan`)
- Modify: `packages/shared/db/src/repositories/keyword.repo.ts` (append inside `KeywordRepo`, after `scheduledNormalizedSet`)
- Modify: `packages/shared/db/src/repositories/candidate.repo.ts` (append inside `CandidateRepo`, at the end of the object)
- Modify: `packages/shared/db/src/repositories/article.repo.ts` (append inside `ArticleRepo`, at the end of the object)
- Test: `packages/shared/db/tests/delete-by-org.integration.test.ts` (new file)

**Interfaces:**
- Consumes: existing `getDb`/`closeDb` from `../src/client`, existing repo objects.
- Produces (Task 2 relies on these exact signatures):
  - `OrgRepo.deleteById(id: string): Promise<boolean>` — true when a doc matched
  - `KeywordRepo.deleteByOrgId(orgId: string): Promise<number>` — deleted count
  - `CandidateRepo.deleteByOrgId(orgId: string): Promise<number>` — deleted count
  - `ArticleRepo.deleteByOrgId(orgId: string): Promise<number>` — deleted count

- [ ] **Step 1: Write the failing integration test**

Create `packages/shared/db/tests/delete-by-org.integration.test.ts`. Fixtures are raw driver inserts with unique org ids (no global collection wipes — other integration test files may share the DB), because `deleteMany` matches on `org_id` only and never parses entities:

```ts
import { ObjectId } from 'mongodb';
import { afterAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ArticleRepo } from '../src/repositories/article.repo';
import { CandidateRepo } from '../src/repositories/candidate.repo';
import { KeywordRepo } from '../src/repositories/keyword.repo';
import { OrgRepo } from '../src/repositories/org.repo';

/**
 * Real-MongoDB round-trip for the `db reset-user` delete methods. Run with
 * `npm run test:integration` after `docker compose up -d mongo`. Fixtures are
 * raw inserts scoped to unique org ids: deleteByOrgId matches on org_id only,
 * so full valid entities aren't needed and other test files stay untouched.
 */
describe('delete-by-org (integration)', () => {
  afterAll(async () => {
    await closeDb();
  });

  test('KeywordRepo.deleteByOrgId removes only that org\'s keywords', async () => {
    const col = (await getDb()).collection('keywords');
    await col.insertMany([
      { org_id: 'reset_kw_a', keyword: 'k1' },
      { org_id: 'reset_kw_a', keyword: 'k2' },
      { org_id: 'reset_kw_b', keyword: 'k3' },
    ]);

    expect(await KeywordRepo.deleteByOrgId('reset_kw_a')).toBe(2);
    expect(await col.countDocuments({ org_id: 'reset_kw_a' })).toBe(0);
    expect(await col.countDocuments({ org_id: 'reset_kw_b' })).toBe(1);
  });

  test('CandidateRepo.deleteByOrgId removes only that org\'s candidates', async () => {
    const col = (await getDb()).collection('candidates');
    await col.insertMany([
      { org_id: 'reset_cand_a', keyword: 'c1' },
      { org_id: 'reset_cand_b', keyword: 'c2' },
    ]);

    expect(await CandidateRepo.deleteByOrgId('reset_cand_a')).toBe(1);
    expect(await col.countDocuments({ org_id: 'reset_cand_a' })).toBe(0);
    expect(await col.countDocuments({ org_id: 'reset_cand_b' })).toBe(1);
  });

  test('ArticleRepo.deleteByOrgId removes only that org\'s articles', async () => {
    const col = (await getDb()).collection('articles');
    await col.insertMany([
      { org_id: 'reset_art_a', title: 'a1' },
      { org_id: 'reset_art_b', title: 'a2' },
    ]);

    expect(await ArticleRepo.deleteByOrgId('reset_art_a')).toBe(1);
    expect(await col.countDocuments({ org_id: 'reset_art_a' })).toBe(0);
    expect(await col.countDocuments({ org_id: 'reset_art_b' })).toBe(1);
  });

  test('deleteByOrgId returns 0 when nothing matches', async () => {
    expect(await KeywordRepo.deleteByOrgId('reset_no_such_org')).toBe(0);
  });

  test('OrgRepo.deleteById deletes the org and reports the match', async () => {
    const org = await OrgRepo.create({
      user_id: 'reset_user_1',
      website_url: 'https://reset.example.com',
      setup_status: 'setup_scan_in_progress',
    });

    expect(await OrgRepo.deleteById(org.id)).toBe(true);
    expect(await OrgRepo.findById(org.id)).toBeNull();
  });

  test('OrgRepo.deleteById returns false when no org matches', async () => {
    expect(await OrgRepo.deleteById(new ObjectId().toString())).toBe(false);
    expect(await OrgRepo.deleteById('not-an-objectid')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
docker compose up -d mongo
npm run test:integration -- delete-by-org
```

Expected: FAIL — `deleteByOrgId is not a function` / `deleteById is not a function`.

- [ ] **Step 3: Implement the four repo methods**

In `packages/shared/db/src/repositories/org.repo.ts`, add after the `setPlan` method (inside the `OrgRepo` object literal — add a comma after `setPlan`'s closing brace):

```ts
  /** Delete the org (used by the `db reset-user` CLI). Returns true when a doc matched. */
  async deleteById(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).deleteOne({ _id: new ObjectId(id) });
    return res.deletedCount === 1;
  },
```

In `packages/shared/db/src/repositories/keyword.repo.ts`, add after `scheduledNormalizedSet` (inside `KeywordRepo`):

```ts
  /** Delete every keyword for an org (used by the `db reset-user` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
```

In `packages/shared/db/src/repositories/candidate.repo.ts`, add as the last method of `CandidateRepo`:

```ts
  /** Delete every candidate for an org (used by the `db reset-user` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
```

In `packages/shared/db/src/repositories/article.repo.ts`, add as the last method of `ArticleRepo`:

```ts
  /** Delete every article for an org (used by the `db reset-user` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
```

(All four repos already import `ObjectId` and define the `collection` helper — no new imports needed.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:integration -- delete-by-org
```

Expected: PASS (6 tests).

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add packages/shared/db
git commit -m "[db] Repo delete methods for db reset-user

Part of the db reset-user CLI command (spec:
docs/superpowers/specs/2026-07-09-cli-reset-user-design.md).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `resetUser` lib function

**Files:**
- Modify: `apps/cli/src/types.ts` (add `ResetUserData` after `SetPlanData`, ~line 62)
- Modify: `apps/cli/src/lib/db.ts` (add `resetUser`, extend the `@shared/db` import)
- Test: `apps/cli/tests/db.test.ts` (extend existing mocks + add a `describe` block)

**Interfaces:**
- Consumes (from Task 1): `OrgRepo.deleteById(id): Promise<boolean>`, `KeywordRepo.deleteByOrgId(orgId): Promise<number>`, `CandidateRepo.deleteByOrgId(orgId): Promise<number>`, `ArticleRepo.deleteByOrgId(orgId): Promise<number>`; plus existing `UserRepo.findByEmail`, `OrgRepo.findByUserId`, `closeDb`.
- Produces (Task 3 relies on this):
  - `resetUser(input: { user?: string }): Promise<Result<ResetUserData>>` exported from `apps/cli/src/lib/db.ts`
  - `ResetUserData` = `{ user_id: string; org_ids: string[]; deleted: { orgs: number; keywords: number; candidates: number; articles: number } }`
  - Error codes: `BAD_TARGET` (no `--user`), `USER_NOT_FOUND`

- [ ] **Step 1: Write the failing unit tests**

In `apps/cli/tests/db.test.ts`, replace the existing `vi.hoisted` + `vi.mock` block (lines 3–21) with this superset (existing spies unchanged, four new ones added, three new mocked repos):

```ts
const {
  ensureIndexes,
  closeDb,
  setPlan,
  findByUserId,
  findByEmail,
  deleteOrgById,
  deleteKeywordsByOrgId,
  deleteCandidatesByOrgId,
  deleteArticlesByOrgId,
} = vi.hoisted(() => ({
  ensureIndexes: vi.fn(async () => {}),
  closeDb: vi.fn(async () => {}),
  setPlan: vi.fn(async () => true),
  findByUserId: vi.fn(async () => [{ id: 'org_1' }]),
  findByEmail: vi.fn(
    async (): Promise<{ id: string; email: string } | null> => ({
      id: 'u_1',
      email: 'dev@example.com',
    }),
  ),
  deleteOrgById: vi.fn(async () => true),
  deleteKeywordsByOrgId: vi.fn(async () => 3),
  deleteCandidatesByOrgId: vi.fn(async () => 2),
  deleteArticlesByOrgId: vi.fn(async () => 1),
}));

vi.mock('@shared/db', () => ({
  ensureIndexes,
  closeDb,
  OrgRepo: { setPlan, findByUserId, deleteById: deleteOrgById },
  UserRepo: { findByEmail },
  KeywordRepo: { deleteByOrgId: deleteKeywordsByOrgId },
  CandidateRepo: { deleteByOrgId: deleteCandidatesByOrgId },
  ArticleRepo: { deleteByOrgId: deleteArticlesByOrgId },
}));
```

Change the import line to include the new function:

```ts
import { initDb, resetUser, setOrgPlan } from '../src/lib/db';
```

Append a new `describe` block at the end of the file:

```ts
describe('resetUser', () => {
  test('deletes org data, the org, and reports counts', async () => {
    const res = await resetUser({ user: 'dev@example.com' });
    expect(findByEmail).toHaveBeenCalledWith('dev@example.com');
    expect(deleteKeywordsByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteCandidatesByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteArticlesByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteOrgById).toHaveBeenCalledWith('org_1');
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({
      user_id: 'u_1',
      org_ids: ['org_1'],
      deleted: { orgs: 1, keywords: 3, candidates: 2, articles: 1 },
    });
  });

  test('wipes every org for a multi-org user, summing counts', async () => {
    findByUserId.mockResolvedValueOnce([{ id: 'org_1' }, { id: 'org_2' }]);
    const res = await resetUser({ user: 'dev@example.com' });
    expect(deleteKeywordsByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteKeywordsByOrgId).toHaveBeenCalledWith('org_2');
    expect(deleteOrgById).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.org_ids).toEqual(['org_1', 'org_2']);
    expect(res.data.deleted).toEqual({ orgs: 2, keywords: 6, candidates: 4, articles: 2 });
  });

  test('succeeds with zero counts when the user owns no org', async () => {
    findByUserId.mockResolvedValueOnce([]);
    const res = await resetUser({ user: 'dev@example.com' });
    expect(deleteKeywordsByOrgId).not.toHaveBeenCalled();
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.deleted).toEqual({ orgs: 0, keywords: 0, candidates: 0, articles: 0 });
  });

  test('fails when the email matches no user', async () => {
    findByEmail.mockResolvedValueOnce(null);
    const res = await resetUser({ user: 'nobody@example.com' });
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('USER_NOT_FOUND');
  });

  test('fails without --user', async () => {
    const res = await resetUser({});
    expect(findByEmail).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('BAD_TARGET');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- db.test
```

Expected: FAIL — `resetUser` is not exported from `../src/lib/db`. The pre-existing `initDb`/`setOrgPlan` tests must still pass.

- [ ] **Step 3: Implement `ResetUserData` and `resetUser`**

In `apps/cli/src/types.ts`, add after the `SetPlanData` interface:

```ts
export interface ResetUserData {
  user_id: string;
  org_ids: string[];
  deleted: { orgs: number; keywords: number; candidates: number; articles: number };
}
```

In `apps/cli/src/lib/db.ts`, extend the imports:

```ts
import {
  ArticleRepo,
  CandidateRepo,
  closeDb,
  ensureIndexes,
  KeywordRepo,
  OrgRepo,
  UserRepo,
} from '@shared/db';
import { ENTITLEMENT_PLANS, type EntitlementPlan } from '@shared/types';
import {
  type DbInitData,
  fail,
  ok,
  type ResetUserData,
  type Result,
  type SetPlanData,
} from '../types';
```

Append at the end of the file:

```ts
/**
 * Delete a user's orgs and all org-scoped data (keywords, candidates,
 * articles) so the next login re-runs onboarding. The user document stays —
 * login recreates session state and the onboarding gate is org-presence.
 * Idempotent: a user with no orgs is a success with zero counts. Operates
 * against whatever `MONGODB_URI` is configured.
 */
export async function resetUser(input: { user?: string }): Promise<Result<ResetUserData>> {
  const { user } = input;
  if (!user) return fail('BAD_TARGET', 'Provide --user <email>.');

  try {
    const found = await UserRepo.findByEmail(user);
    if (!found) return fail('USER_NOT_FOUND', `No user with email "${user}".`);

    const orgs = await OrgRepo.findByUserId(found.id);
    const deleted = { orgs: 0, keywords: 0, candidates: 0, articles: 0 };
    for (const org of orgs) {
      deleted.keywords += await KeywordRepo.deleteByOrgId(org.id);
      deleted.candidates += await CandidateRepo.deleteByOrgId(org.id);
      deleted.articles += await ArticleRepo.deleteByOrgId(org.id);
      if (await OrgRepo.deleteById(org.id)) deleted.orgs += 1;
    }
    return ok({ user_id: found.id, org_ids: orgs.map((o) => o.id), deleted });
  } finally {
    await closeDb();
  }
}
```

Note the `BAD_TARGET` check sits **before** the `try` — same as `setOrgPlan`'s validation, so `closeDb` isn't called for pure input errors (the test asserts `findByEmail` wasn't called, not `closeDb`).

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- db.test
```

Expected: PASS — all `initDb`, `setOrgPlan`, and `resetUser` tests green.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
git add apps/cli/src/types.ts apps/cli/src/lib/db.ts apps/cli/tests/db.test.ts
git commit -m "[cli] resetUser lib — wipe a user's orgs + org data

Part of the db reset-user CLI command (spec:
docs/superpowers/specs/2026-07-09-cli-reset-user-design.md).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `db reset-user` command wiring + full verification

**Files:**
- Modify: `apps/cli/src/commands/db.ts` (add a `reset-user` subcommand after `set-plan`)

**Interfaces:**
- Consumes (from Task 2): `resetUser(input: { user?: string }): Promise<Result<ResetUserData>>` from `../lib/db`.
- Produces: `db reset-user` subcommand — exit 0 on success, 1 (`EXIT.USER_ERROR`) on failure.

No new unit test: command handlers here are thin Result→emitter/exit translators and have no per-command tests (`set-plan` precedent); the smoke test covers CLI startup. Verification is running the command.

- [ ] **Step 1: Add the subcommand**

In `apps/cli/src/commands/db.ts`, inside `subCommands`, add after the `'set-plan'` entry:

```ts
    'reset-user': defineCommand({
      meta: {
        name: 'reset-user',
        description:
          "Delete a user's orgs and all org data so onboarding re-runs (dev/staging helper)",
      },
      args: {
        user: { type: 'string', description: "User's email; wipes every org they own" },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { resetUser } = await import('../lib/db');

          emitter.warn('Applies to whatever MONGODB_URI targets — never run this against prod.');
          emitter.step('db:reset-user', 'start');

          const result = await resetUser({ user: args.user as string | undefined });
          emitter.step('db:reset-user', result.ok ? 'done' : 'fail');
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
```

- [ ] **Step 2: Verify the command end-to-end against local Mongo**

```bash
npm run cli -- db reset-user --help
```

Expected: exit 0, usage shows `--user`.

```bash
npm run cli -- db reset-user --output json
```

Expected: exit 1, JSON result with `error.code: "BAD_TARGET"`.

```bash
docker compose up -d mongo
npm run cli -- db reset-user --user nobody@example.com --output json
```

Expected: exit 1, `error.code: "USER_NOT_FOUND"` (assuming that email doesn't exist locally). If a real dev user exists locally, optionally run with that email and confirm `deleted` counts + that the web app's next login lands on onboarding.

- [ ] **Step 3: Run the full check suite**

```bash
npm run lint && npm run check:all && npm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/cli/src/commands/db.ts
git commit -m "[cli] Add \`db reset-user\` — wipe a dev user's orgs to re-run onboarding

Deletes the user's orgs and all org-scoped data (keywords, candidates,
articles). The user doc stays; the onboarding gate is org-presence, so the
next login restarts setup. Spec:
docs/superpowers/specs/2026-07-09-cli-reset-user-design.md

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
