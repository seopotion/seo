# Org Membership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An org owner adds teammates by email; a teammate who logs in with Google sees the org and can do everything except billing and team management.

**Architecture:** `orgs.user_id` stays the owner. A new `org_members` collection holds `{org_id, email}` rows. One helper, `loadOrgForUser(org_id, auth)`, replaces `loadOwnedOrg` and answers "owner / member / no access". `GET /core/organizations` returns owned plus member orgs with a `role`. New `/core/members` routes and a Team tab in settings manage the roster.

**Tech Stack:** Hono + `@hono/zod-openapi`, Zod 4, mongodb driver 7, Vitest 4 (`node` project for `.test.ts`, `web-dom` jsdom project for `.test.tsx`), Next 16 + react-query + next-intl, Biome.

Spec: `docs/superpowers/specs/2026-09-05-org-membership-design.md`.

## Global Constraints

- Every route uses `OpenAPIHono` + `createRoute` chained with `.openapi(...)`; API schemas use `.openapi('Name')` and export both schema and `z.infer` type.
- Type-only imports use `import type` / `export type` (`verbatimModuleSyntax`).
- Emails are stored and compared lowercased.
- 404 for "org missing or caller has no access" on every org-scoped route (existence never leaks). 403 `{ error: 'Owner only' }` for a member on an owner-only route.
- Biome: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after writing code.
- Run from the worktree root: `/Users/fco/Documents/projects/seopotion/seo/.claude/worktrees/issue-35-deployment-options-2a7227`. If `node_modules` is missing or stale there, run `npm ci` first (memory: worktree resolution trap).
- `npm test` has one expected local failure, `wordpress-plugin-behavior.test.ts` (needs `php`); it passes in CI. Every other test must pass.
- Commit after every task with `Part of #333` in the body and the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` trailer.
- Do not touch `OrganizationSwitcher.tsx`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/shared/types/src/index.ts` | add `ORG_ROLES` / `OrgRole` |
| `packages/shared/schemas/src/org-member.ts` (new) | `OrgMemberSchema`, `OrgMember`, `CreateOrgMemberInput` |
| `packages/shared/schemas/src/index.ts` | export the above and re-export `OrgRole` |
| `packages/shared/db/src/repositories/org-member.repo.ts` (new) | `OrgMemberRepo` |
| `packages/shared/db/src/repositories/org.repo.ts` | `findAccessible(userId, memberOrgIds)` |
| `packages/shared/db/src/ensure-indexes.ts` | `org_members` indexes |
| `packages/shared/db/src/index.ts` | export `OrgMemberRepo` |
| `apps/api/src/lib/load-org-for-user.ts` (new, replaces `load-owned-org.ts`) | `loadOrgForUser`, `loadAccessibleOrg` |
| `apps/api/src/lib/load-owned-paid-org.ts` | membership-aware paid gate |
| `apps/api/src/lib/list-accessible-orgs.ts` (new) | owned + member orgs for one auth context |
| `apps/api/src/routes/{analytics,dashboard,gsc,integrations,keywords,setup}.ts` | mechanical rename to `loadAccessibleOrg` |
| `apps/api/src/routes/billing.ts` | owner-only check |
| `apps/api/src/routes/core.ts`, `apps/api/src/schemas/core.ts` | `role` on organizations, accessible list for status |
| `apps/api/src/routes/members.ts`, `apps/api/src/schemas/members.ts` (new) | roster routes |
| `apps/api/src/routes/index.ts` | mount `/core/members` |
| `apps/web/lib/organizations.ts` | `role` on `ProductOrganization` |
| `apps/web/lib/dashboard-query-keys.ts` | `members(orgId)` |
| `apps/web/app/[locale]/(authenticated)/(product)/settings/_components/TeamPanel.tsx` (new) | roster UI |
| `apps/web/app/[locale]/(authenticated)/(product)/settings/page.tsx` | `team` tab |
| `apps/web/messages/{en,tr}.json` | `SettingsPage.tabs.team`, `SettingsPage.team.*` |
| `apps/cli/src/lib/db.ts`, `apps/cli/src/types.ts` | delete-org sweep counts members |
| `PROGRESS.md` | one line for #333 |

---

### Task 1: Shared types, schema, repository, indexes

**Files:**
- Modify: `packages/shared/types/src/index.ts`
- Create: `packages/shared/schemas/src/org-member.ts`
- Modify: `packages/shared/schemas/src/index.ts`
- Create: `packages/shared/db/src/repositories/org-member.repo.ts`
- Modify: `packages/shared/db/src/repositories/org.repo.ts`
- Modify: `packages/shared/db/src/ensure-indexes.ts`
- Modify: `packages/shared/db/src/index.ts`

**Interfaces:**
- Produces:
  - `ORG_ROLES = ['owner', 'member'] as const`, `type OrgRole` (from `@shared/types` and re-exported by `@shared/schemas`)
  - `OrgMemberSchema`, `type OrgMember = { id; org_id; email; invited_by; created_at: Date }`, `CreateOrgMemberInput = { org_id; email; invited_by }`
  - `OrgMemberRepo.listByOrgId(orgId): Promise<OrgMember[]>`
  - `OrgMemberRepo.findByOrgAndEmail(orgId, email): Promise<OrgMember | null>`
  - `OrgMemberRepo.listOrgIdsByEmail(email): Promise<string[]>`
  - `OrgMemberRepo.add(input: CreateOrgMemberInput): Promise<OrgMember | null>` (null on duplicate)
  - `OrgMemberRepo.remove(orgId, email): Promise<boolean>`
  - `OrgMemberRepo.deleteByOrgId(orgId): Promise<number>`
  - `OrgRepo.findAccessible(userId, memberOrgIds: string[]): Promise<Org[]>` (owned first, then member orgs, each by `created_at` ascending)

Repositories in this repo have no unit tests (they are thin driver calls, covered by the integration suite pattern). This task is verified by `npm run check:all` and by the route tests in later tasks.

- [ ] **Step 1: Add the role constant**

In `packages/shared/types/src/index.ts`, append:

```ts
/** Org membership roles (#333). `owner` is `orgs.user_id`; `member` is a row in `org_members`. */
export const ORG_ROLES = ['owner', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
```

- [ ] **Step 2: Create the entity schema**

Create `packages/shared/schemas/src/org-member.ts`:

```ts
import { z } from 'zod';

/**
 * A teammate on an org (#333). The owner is never a row here — ownership is
 * `orgs.user_id`. Membership is keyed by email, not user id, so an owner can
 * add someone before they have ever logged in; Google verifies the email at
 * login, which is what makes the match safe. Stored lowercased.
 */
export const OrgMemberSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  email: z.string().email(),
  /** User id of the owner who added the row. */
  invited_by: z.string(),
  created_at: z.date(),
});
export type OrgMember = z.infer<typeof OrgMemberSchema>;

export const CreateOrgMemberInput = OrgMemberSchema.omit({ id: true, created_at: true });
export type CreateOrgMemberInput = z.infer<typeof CreateOrgMemberInput>;
```

- [ ] **Step 3: Export it from the schemas package**

In `packages/shared/schemas/src/index.ts`, change line 1 to re-export the role type and add the new module in alphabetical order:

```ts
export type { EntitlementPlan, OrgRole, SetupStatus, StrategyStatus } from '@shared/types';
```

and after `export * from './org';` add:

```ts
export * from './org-member';
```

- [ ] **Step 4: Create the repository**

Create `packages/shared/db/src/repositories/org-member.repo.ts`:

```ts
import {
  type CreateOrgMemberInput,
  CreateOrgMemberInput as CreateOrgMemberInputSchema,
  type OrgMember,
  OrgMemberSchema,
} from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';
import { isDuplicateKeyError } from '../services/schedule-candidate';

const collection = async () => (await getDb()).collection('org_members');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): OrgMember {
  const { _id, ...rest } = doc;
  return OrgMemberSchema.parse({ id: _id.toString(), ...rest });
}

const normalize = (email: string) => email.trim().toLowerCase();

export const OrgMemberRepo = {
  /** Roster for an org, oldest first. */
  async listByOrgId(orgId: string): Promise<OrgMember[]> {
    const docs = await (await collection()).find({ org_id: orgId }).sort({ created_at: 1 }).toArray();
    return docs.map(toEntity);
  },

  async findByOrgAndEmail(orgId: string, email: string): Promise<OrgMember | null> {
    const doc = await (await collection()).findOne({ org_id: orgId, email: normalize(email) });
    return doc ? toEntity(doc) : null;
  },

  /** Ids of every org this email was added to. */
  async listOrgIdsByEmail(email: string): Promise<string[]> {
    const docs = await (await collection())
      .find({ email: normalize(email) }, { projection: { org_id: 1 } })
      .toArray();
    return docs.map((d) => String(d.org_id));
  },

  /** Insert a member. Returns null when `(org_id, email)` already exists. */
  async add(input: CreateOrgMemberInput): Promise<OrgMember | null> {
    const data = CreateOrgMemberInputSchema.parse({ ...input, email: normalize(input.email) });
    const created_at = new Date();
    try {
      const res = await (await collection()).insertOne({ ...data, created_at });
      return toEntity({ _id: res.insertedId, ...data, created_at });
    } catch (e) {
      if (isDuplicateKeyError(e)) return null;
      throw e;
    }
  },

  /** Returns true when a row matched. */
  async remove(orgId: string, email: string): Promise<boolean> {
    const res = await (await collection()).deleteOne({ org_id: orgId, email: normalize(email) });
    return res.deletedCount === 1;
  },

  /** delete-org sweep. Returns the number of rows removed. */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
};
```

Check that `isDuplicateKeyError` is exported from `packages/shared/db/src/services/schedule-candidate.ts` (the db index re-exports it, so it is). If it lives elsewhere, import from there.

- [ ] **Step 5: Add `findAccessible` to `OrgRepo`**

In `packages/shared/db/src/repositories/org.repo.ts`, directly after `findByUserId`, add:

```ts
  /**
   * Orgs the user may see (#333): the ones they own plus the ones they were
   * added to. Owned first, then member orgs, each oldest-first — the switcher
   * renders in this order.
   */
  async findAccessible(userId: string, memberOrgIds: string[]): Promise<Org[]> {
    const ids = memberOrgIds.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id));
    const docs = await (await collection())
      .find({ $or: [{ user_id: userId }, { _id: { $in: ids } }] })
      .sort({ created_at: 1 })
      .toArray();
    const orgs = docs.map(toEntity);
    return [
      ...orgs.filter((o) => o.user_id === userId),
      ...orgs.filter((o) => o.user_id !== userId),
    ];
  },
```

- [ ] **Step 6: Add the indexes**

In `packages/shared/db/src/ensure-indexes.ts`, after the two `orgs` index lines (line 14), add:

```ts
  // Org membership (#333): one row per (org, email); the email index backs
  // "orgs I was added to" on every org-list and status call.
  await db.collection('org_members').createIndex({ org_id: 1, email: 1 }, { unique: true });
  await db.collection('org_members').createIndex({ email: 1 });
```

- [ ] **Step 7: Export the repo**

In `packages/shared/db/src/index.ts`, after the `OrgRepo` export line add:

```ts
export { OrgMemberRepo } from './repositories/org-member.repo';
```

- [ ] **Step 8: Typecheck and lint**

Run: `npm run lint:fix && npm run check:all`
Expected: both clean.

- [ ] **Step 9: Commit**

```bash
git add packages/shared
git commit -m "shared: org_members entity, repo, indexes; OrgRepo.findAccessible

Part of #333

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `loadOrgForUser` and the paid gate

**Files:**
- Create: `apps/api/src/lib/load-org-for-user.ts`
- Delete: `apps/api/src/lib/load-owned-org.ts`
- Create: `apps/api/tests/load-org-for-user.test.ts`
- Modify: `apps/api/src/lib/load-owned-paid-org.ts`
- Modify: `apps/api/tests/load-owned-paid-org.test.ts`

**Interfaces:**
- Consumes: `OrgRepo.findById`, `OrgMemberRepo.findByOrgAndEmail`, `OrgRole` from Task 1; `AuthContext = { userId: string; email: string }` from `apps/api/src/middlewares/auth.ts`.
- Produces:
  - `type OrgAccess = { org: Org; role: OrgRole }`
  - `loadOrgForUser(org_id: string, auth: AuthContext): Promise<OrgAccess | null>`
  - `loadAccessibleOrg(org_id: string, auth: AuthContext): Promise<Org | null>` (the org alone; what the mechanical migration in Task 3 uses)
  - `loadOwnedPaidOrg(orgId: string, auth: AuthContext): Promise<OwnedPaidResult>` with reasons `'not_found' | 'not_paid'` (a missing or inaccessible org is `not_found`, so existence never leaks)

Deleting `load-owned-org.ts` breaks the routes until Task 3; that is expected. Run only the two test files named here in this task.

- [ ] **Step 1: Write the failing test for `loadOrgForUser`**

Create `apps/api/tests/load-org-for-user.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

const { findById, findByOrgAndEmail } = vi.hoisted(() => ({
  findById: vi.fn(),
  findByOrgAndEmail: vi.fn(),
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  OrgMemberRepo: { findByOrgAndEmail },
}));

import { loadAccessibleOrg, loadOrgForUser } from '../src/lib/load-org-for-user';

const org = {
  id: 'o1',
  user_id: 'owner',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  plan: 'free',
  strategy_status: 'none',
  created_at: new Date(),
};
const owner = { userId: 'owner', email: 'owner@example.com' };
const teammate = { userId: 'mate', email: 'Mate@Example.com' };
const stranger = { userId: 'x', email: 'x@example.com' };

describe('loadOrgForUser', () => {
  test('null when the org is missing', async () => {
    findById.mockResolvedValueOnce(null);
    expect(await loadOrgForUser('o1', owner)).toBeNull();
    expect(findByOrgAndEmail).not.toHaveBeenCalled();
  });

  test('owner role for orgs.user_id, without touching org_members', async () => {
    findById.mockResolvedValueOnce(org);
    expect(await loadOrgForUser('o1', owner)).toEqual({ org, role: 'owner' });
    expect(findByOrgAndEmail).not.toHaveBeenCalled();
  });

  test('member role when an org_members row matches the lowercased email', async () => {
    findById.mockResolvedValueOnce(org);
    findByOrgAndEmail.mockResolvedValueOnce({ id: 'm1', org_id: 'o1', email: 'mate@example.com' });
    expect(await loadOrgForUser('o1', teammate)).toEqual({ org, role: 'member' });
    expect(findByOrgAndEmail).toHaveBeenCalledWith('o1', 'mate@example.com');
  });

  test('null for a stranger', async () => {
    findById.mockResolvedValueOnce(org);
    findByOrgAndEmail.mockResolvedValueOnce(null);
    expect(await loadOrgForUser('o1', stranger)).toBeNull();
  });
});

describe('loadAccessibleOrg', () => {
  test('returns the org for a member and null for a stranger', async () => {
    findById.mockResolvedValueOnce(org);
    findByOrgAndEmail.mockResolvedValueOnce({ id: 'm1', org_id: 'o1', email: 'mate@example.com' });
    expect(await loadAccessibleOrg('o1', teammate)).toEqual(org);

    findById.mockResolvedValueOnce(org);
    findByOrgAndEmail.mockResolvedValueOnce(null);
    expect(await loadAccessibleOrg('o1', stranger)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npm test -- load-org-for-user`
Expected: FAIL, cannot resolve `../src/lib/load-org-for-user`.

- [ ] **Step 3: Write the helper and delete the old one**

Create `apps/api/src/lib/load-org-for-user.ts`:

```ts
import { OrgMemberRepo, OrgRepo } from '@shared/db';
import type { Org, OrgRole } from '@shared/schemas';
import type { AuthContext } from '../middlewares/auth';

export type OrgAccess = { org: Org; role: OrgRole };

/**
 * Load an org only if the caller owns it or is a member (#333). Returns `null`
 * when the org is missing OR the caller has no access — callers map both to
 * 404 so org existence is never leaked across accounts.
 */
export async function loadOrgForUser(org_id: string, auth: AuthContext): Promise<OrgAccess | null> {
  const org = await OrgRepo.findById(org_id);
  if (!org) return null;
  if (org.user_id === auth.userId) return { org, role: 'owner' };
  const member = await OrgMemberRepo.findByOrgAndEmail(org_id, auth.email.toLowerCase());
  return member ? { org, role: 'member' } : null;
}

/** `loadOrgForUser` for routes that do not care about the role. */
export async function loadAccessibleOrg(org_id: string, auth: AuthContext): Promise<Org | null> {
  return (await loadOrgForUser(org_id, auth))?.org ?? null;
}
```

Then delete the old file:

```bash
git rm apps/api/src/lib/load-owned-org.ts
```

- [ ] **Step 4: Run the test**

Run: `npm test -- load-org-for-user`
Expected: PASS (5 tests).

- [ ] **Step 5: Update the paid-gate test**

The old gate answered `not_owner` (403) for a stranger, which leaked org existence through the one helper that did not 404. With membership, "no access" collapses into `not_found`, the same contract every other org-scoped route has. Replace the whole of `apps/api/tests/load-owned-paid-org.test.ts` with:

```ts
import { describe, expect, test, vi } from 'vitest';

const { findById, findByOrgAndEmail } = vi.hoisted(() => ({
  findById: vi.fn(),
  findByOrgAndEmail: vi.fn(),
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  OrgMemberRepo: { findByOrgAndEmail },
}));

import { loadOwnedPaidOrg } from '../src/lib/load-owned-paid-org';

const org = (over: Record<string, unknown>) => ({
  id: 'o1',
  user_id: 'u1',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  plan: 'paid',
  strategy_status: 'none',
  created_at: new Date(),
  ...over,
});
const owner = { userId: 'u1', email: 'u1@example.com' };
const teammate = { userId: 'u2', email: 'u2@example.com' };

describe('loadOwnedPaidOrg', () => {
  test('not_found when missing', async () => {
    findById.mockResolvedValueOnce(null);
    expect(await loadOwnedPaidOrg('o1', owner)).toEqual({ ok: false, reason: 'not_found' });
  });
  test('not_found for a stranger (existence never leaks)', async () => {
    findById.mockResolvedValueOnce(org({ user_id: 'someone_else' }));
    findByOrgAndEmail.mockResolvedValueOnce(null);
    expect(await loadOwnedPaidOrg('o1', owner)).toEqual({ ok: false, reason: 'not_found' });
  });
  test('not_paid for free plan', async () => {
    findById.mockResolvedValueOnce(org({ plan: 'free' }));
    expect(await loadOwnedPaidOrg('o1', owner)).toEqual({ ok: false, reason: 'not_paid' });
  });
  test('ok for an owned paid org', async () => {
    const paid = org({});
    findById.mockResolvedValueOnce(paid);
    expect(await loadOwnedPaidOrg('o1', owner)).toEqual({ ok: true, org: paid });
  });
  test('ok for a member of a paid org', async () => {
    const paid = org({});
    findById.mockResolvedValueOnce(paid);
    findByOrgAndEmail.mockResolvedValueOnce({ id: 'm1', org_id: 'o1', email: 'u2@example.com' });
    expect(await loadOwnedPaidOrg('o1', teammate)).toEqual({ ok: true, org: paid });
  });
});
```

- [ ] **Step 6: Run it to see it fail**

Run: `npm test -- load-owned-paid-org`
Expected: FAIL (signature mismatch; `not_owner` returned for the stranger).

- [ ] **Step 7: Rewrite the paid gate**

Replace the whole of `apps/api/src/lib/load-owned-paid-org.ts` with:

```ts
import { isPaid, type Org } from '@shared/schemas';
import type { AuthContext } from '../middlewares/auth';
import { loadOrgForUser } from './load-org-for-user';

export type OwnedPaidResult =
  | { ok: true; org: Org }
  | { ok: false; reason: 'not_found' | 'not_paid' };

/**
 * Load an org the caller may act on (owner or member, #333) AND that has an
 * active paid entitlement. Missing and inaccessible orgs are both `not_found`
 * (404) so existence never leaks; `not_paid` maps to 402 so the client can
 * route to billing.
 */
export async function loadOwnedPaidOrg(orgId: string, auth: AuthContext): Promise<OwnedPaidResult> {
  const access = await loadOrgForUser(orgId, auth);
  if (!access) return { ok: false, reason: 'not_found' };
  if (!isPaid(access.org)) return { ok: false, reason: 'not_paid' };
  return { ok: true, org: access.org };
}
```

- [ ] **Step 8: Run both tests**

Run: `npm test -- load-owned-paid-org load-org-for-user`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib apps/api/tests/load-org-for-user.test.ts apps/api/tests/load-owned-paid-org.test.ts
git commit -m "api: loadOrgForUser replaces loadOwnedOrg; paid gate accepts members

Part of #333

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Mechanical migration of every org-scoped route

**Files:**
- Modify: `apps/api/src/routes/analytics.ts`, `dashboard.ts`, `gsc.ts`, `integrations.ts`, `keywords.ts`, `setup.ts`
- Modify tests: `apps/api/tests/analytics.test.ts`, `dashboard.test.ts`, `gsc.test.ts`, `integrations.test.ts`, `setup.test.ts`, `keywords.test.ts`

**Interfaces:**
- Consumes: `loadAccessibleOrg(org_id, auth)` and `loadOwnedPaidOrg(orgId, auth)` from Task 2.
- Produces: nothing new. Behaviour for owners is unchanged; members now pass.

- [ ] **Step 1: Rewrite the imports and calls with one script**

From the worktree root:

```bash
cd apps/api/src/routes
perl -pi -e "s#import \{ loadOwnedOrg \} from '../lib/load-owned-org';#import { loadAccessibleOrg } from '../lib/load-org-for-user';#" analytics.ts dashboard.ts gsc.ts integrations.ts keywords.ts setup.ts
perl -pi -e "s/loadOwnedOrg\(([^,()]+), userId\)/loadAccessibleOrg(\$1, c.get('auth'))/g" analytics.ts dashboard.ts gsc.ts integrations.ts keywords.ts setup.ts
perl -pi -e "s/loadOwnedPaidOrg\(org_id, userId\)/loadOwnedPaidOrg(org_id, c.get('auth'))/g" keywords.ts
grep -n "loadOwnedOrg" *.ts && echo "LEFTOVERS ABOVE" || echo "no leftovers"
cd -
```

Expected: `no leftovers`. Also update the two comments in `dashboard.ts` that say `(same rule as loadOwnedOrg)` to `(same rule as loadAccessibleOrg)`.

- [ ] **Step 2: Collapse `gateStatus` in the keywords routes**

In `apps/api/src/routes/keywords.ts` lines 18–21, the gate no longer has a 403 case:

```ts
/** Map a loadOwnedPaidOrg failure to its HTTP status. */
function gateStatus(reason: Exclude<OwnedPaidResult, { ok: true }>['reason']): 404 | 402 {
  return reason === 'not_found' ? 404 : 402;
}
```

If the two routes that call `gateStatus` declare a `403` response in their `createRoute` (search for `403:` near `/research` and `/candidates`), delete that response entry.

- [ ] **Step 3: Remove `userId` destructures that became unused**

Run: `npm run lint`
For each `const { userId } = c.get('auth');` Biome reports unused, delete that line. Keep the ones still used (GSC and GitHub state signing, `start_scan`, and any `claims.user_id !== userId` comparisons). Then:

Run: `npm run lint:fix && npm run check:all`
Expected: clean.

- [ ] **Step 4: Give the five route test files an `OrgMemberRepo` stub**

Each of these tests mocks `@shared/db` and has an "org owned by someone else → 404" case that now reaches `OrgMemberRepo.findByOrgAndEmail`. Add the stub next to `OrgRepo` in each mock:

- `apps/api/tests/analytics.test.ts` (inside the returned object, after `OrgRepo: {...},`)
- `apps/api/tests/dashboard.test.ts` (same)
- `apps/api/tests/gsc.test.ts` (in the `vi.mock('@shared/db', () => ({ ... }))` literal)
- `apps/api/tests/integrations.test.ts` (same)
- `apps/api/tests/setup.test.ts` (same)

Add:

```ts
    OrgMemberRepo: { findByOrgAndEmail: vi.fn(async () => null) },
```

- [ ] **Step 5: Repoint the keywords test mock**

In `apps/api/tests/keywords.test.ts` lines 44–45, replace:

```ts
const { loadOwnedOrg } = vi.hoisted(() => ({ loadOwnedOrg: vi.fn() }));
vi.mock('../src/lib/load-owned-org', () => ({ loadOwnedOrg }));
```

with:

```ts
const { loadAccessibleOrg } = vi.hoisted(() => ({ loadAccessibleOrg: vi.fn() }));
vi.mock('../src/lib/load-org-for-user', () => ({ loadAccessibleOrg }));
```

and rename every `loadOwnedOrg.` usage in that file to `loadAccessibleOrg.`:

```bash
perl -pi -e 's/\bloadOwnedOrg\b/loadAccessibleOrg/g' apps/api/tests/keywords.test.ts
```

`keywords.test.ts` line 117 has `test('403 for an org owned by someone else', …)` that mocks `loadOwnedPaidOrg` with `reason: 'not_owner'`. Rewrite it:

```ts
  test('404 for an org owned by someone else (existence never leaks)', async () => {
    loadOwnedPaidOrg.mockResolvedValueOnce({ ok: false, reason: 'not_found' });
    const res = await client.research.$post({ json: { org_id: 'o1', seed: 'crm' } });
    expect(res.status).toBe(404);
  });
```

Keep whatever request line the existing test uses; only the reason and the expected status change.

- [ ] **Step 6: Run the API suite**

Run: `npm test -- apps/api`
Expected: everything passes except `billing.test.ts` (still mocks the deleted module; fixed in Task 4) and the known `wordpress-plugin-behavior` php failure.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "api: org-scoped routes accept members via loadAccessibleOrg

Part of #333

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Billing is owner-only

**Files:**
- Modify: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/tests/billing.test.ts`

**Interfaces:**
- Consumes: `loadOrgForUser` from Task 2.

- [ ] **Step 1: Update the billing test mock and add member cases**

In `apps/api/tests/billing.test.ts` lines 6–7, replace:

```ts
const { loadOwnedOrg } = vi.hoisted(() => ({ loadOwnedOrg: vi.fn() }));
vi.mock('../src/lib/load-owned-org', () => ({ loadOwnedOrg }));
```

with:

```ts
const { loadOrgForUser } = vi.hoisted(() => ({ loadOrgForUser: vi.fn() }));
vi.mock('../src/lib/load-org-for-user', () => ({ loadOrgForUser }));

const owned = (org: Record<string, unknown>) => ({ org, role: 'owner' as const });
```

Then rewrite every existing `loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', ... })` as `loadOrgForUser.mockResolvedValueOnce(owned({ id: 'o1', ... }))`, and every `loadOwnedOrg.mockResolvedValueOnce(null)` as `loadOrgForUser.mockResolvedValueOnce(null)`:

```bash
perl -pi -e "s/loadOwnedOrg\.mockResolvedValueOnce\(null\)/loadOrgForUser.mockResolvedValueOnce(null)/g; s/loadOwnedOrg\.mockResolvedValueOnce\((\{.*?\})\)/loadOrgForUser.mockResolvedValueOnce(owned(\$1))/g" apps/api/tests/billing.test.ts
grep -n "loadOwnedOrg" apps/api/tests/billing.test.ts && echo "LEFTOVERS" || echo "clean"
```

Fix any multi-line leftovers by hand. Then add three tests, one per owner-only route, inside the matching `describe` blocks:

```ts
  test('403 for a member (billing is owner-only)', async () => {
    loadOrgForUser.mockResolvedValueOnce({ org: { id: 'o1', user_id: 'owner', plan: 'free' }, role: 'member' });
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Owner only' });
    expect(createCheckout).not.toHaveBeenCalled();
  });
```

```ts
  test('403 for a member', async () => {
    loadOrgForUser.mockResolvedValueOnce({ org: { id: 'o1', user_id: 'owner', plan: 'paid' }, role: 'member' });
    const res = await testClient(app).portal.$post({ json: { org_id: 'o1' } });
    expect(res.status).toBe(403);
    expect(getCustomerPortalUrl).not.toHaveBeenCalled();
  });
```

```ts
  test('403 for a member', async () => {
    loadOrgForUser.mockResolvedValueOnce({ org: { id: 'o1', user_id: 'owner', plan: 'free' }, role: 'member' });
    const res = await testClient(app).promo.validate.$post({ json: { org_id: 'o1', code: 'X' } });
    expect(res.status).toBe(403);
  });
```

- [ ] **Step 2: Run to see the new cases fail**

Run: `npm test -- billing.test`
Expected: the three member tests fail (they get 200/404 today or a mock-shape error).

- [ ] **Step 3: Update the routes**

In `apps/api/src/routes/billing.ts`:

Replace the import:

```ts
import { loadOrgForUser } from '../lib/load-org-for-user';
```

In `/checkout`, replace

```ts
      const { userId, email } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
```

with

```ts
      const { email } = c.get('auth');
      const access = await loadOrgForUser(org_id, c.get('auth'));
      if (!access) return c.body(null, 403);
      if (access.role !== 'owner') return c.json({ error: 'Owner only' }, 403);
      const { org } = access;
```

In `/portal` and `/promo/validate`, replace

```ts
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
```

with

```ts
      const access = await loadOrgForUser(org_id, c.get('auth'));
      if (!access) return c.body(null, 403);
      if (access.role !== 'owner') return c.json({ error: 'Owner only' }, 403);
      const { org } = access;
```

Update the three `403:` response descriptions to `'Org not found, not accessible, or the caller is not its owner'`. Because the 403 now has a JSON body in one branch, add a schema so the typed client knows it. In `apps/api/src/schemas/billing.ts` add:

```ts
export const OwnerOnlyResponse = z.object({ error: z.literal('Owner only') }).openapi('OwnerOnlyResponse');
```

and set each `403` to `{ content: { 'application/json': { schema: schemas.OwnerOnlyResponse } }, description: '...' }`. The `c.body(null, 403)` branch stays (Hono allows a bodyless response on a declared status).

- [ ] **Step 4: Run the billing test, lint, typecheck**

Run: `npm test -- billing.test && npm run lint:fix && npm run check:all`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/billing.ts apps/api/src/schemas/billing.ts apps/api/tests/billing.test.ts
git commit -m "api: billing checkout, portal and promo validation are owner-only

Part of #333

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `GET /core/organizations` returns member orgs with a role; status follows

**Files:**
- Create: `apps/api/src/lib/list-accessible-orgs.ts`
- Modify: `apps/api/src/schemas/core.ts`
- Modify: `apps/api/src/routes/core.ts`
- Modify: `apps/api/tests/core.test.ts`

**Interfaces:**
- Consumes: `OrgRepo.findAccessible`, `OrgMemberRepo.listOrgIdsByEmail` from Task 1.
- Produces: `listAccessibleOrgs(auth: AuthContext): Promise<Org[]>`; `Organization` response schema gains `role: z.enum(ORG_ROLES)`.

- [ ] **Step 1: Update the core test mock and add cases**

In `apps/api/tests/core.test.ts`, change the `@shared/db` mock. Replace the `OrgRepo` block with:

```ts
  OrgRepo: {
    findAccessible: vi.fn(async (userId: string, memberOrgIds: string[]) => {
      const owned =
        userId === 'user_1'
          ? [
              {
                id: 'org_1',
                user_id: 'user_1',
                website_url: 'https://example.com',
                setup_status: 'setup_complete',
                plan: 'free',
                strategy_status: 'none',
                wordpress_token: 'never-return-this-token',
                wordpress_connected_at: new Date('2026-07-14T10:00:00.000Z'),
                created_at: new Date(),
              },
            ]
          : [];
      const member = memberOrgIds.includes('org_shared')
        ? [
            {
              id: 'org_shared',
              user_id: 'someone_else',
              website_url: 'https://shared.example',
              setup_status: 'setup_complete',
              plan: 'paid',
              strategy_status: 'none',
              created_at: new Date(),
            },
          ]
        : [];
      return [...owned, ...member];
    }),
  },
  OrgMemberRepo: {
    listOrgIdsByEmail: vi.fn(async () => []),
  },
```

Every existing `vi.mocked(OrgRepo.findByUserId).mockResolvedValueOnce(...)` in the file becomes `vi.mocked(OrgRepo.findAccessible).mockResolvedValueOnce(...)`:

```bash
perl -pi -e 's/OrgRepo\.findByUserId/OrgRepo.findAccessible/g' apps/api/tests/core.test.ts
```

In the existing "returns the user orgs" test add:

```ts
    expect(json.organizations[0]?.role).toBe('owner');
```

Add two tests at the end of the `describe`:

```ts
  test('GET /organizations includes orgs the user was added to, with role member', async () => {
    const { OrgMemberRepo } = await import('@shared/db');
    vi.mocked(OrgMemberRepo.listOrgIdsByEmail).mockResolvedValueOnce(['org_shared']);
    const token = await login();
    const res = await client.api.v0.core.organizations.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations.map((o) => [o.id, o.role])).toEqual([
      ['org_1', 'owner'],
      ['org_shared', 'member'],
    ]);
    expect(OrgMemberRepo.listOrgIdsByEmail).toHaveBeenCalledWith('u@example.com');
  });

  test('GET /status is true for a user whose only org is one they were added to', async () => {
    const { OrgRepo, OrgMemberRepo } = await import('@shared/db');
    vi.mocked(OrgMemberRepo.listOrgIdsByEmail).mockResolvedValueOnce(['org_shared']);
    vi.mocked(OrgRepo.findAccessible).mockResolvedValueOnce([
      {
        id: 'org_shared',
        user_id: 'someone_else',
        website_url: 'https://shared.example',
        setup_status: 'setup_complete',
        plan: 'paid',
        strategy_status: 'none',
        created_at: new Date(),
      },
    ]);
    const token = await login();
    const res = await client.api.v0.core.status.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(await res.json()).toEqual({ setup_complete: true });
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- core.test`
Expected: FAIL (`findByUserId` is not a function / `role` undefined).

- [ ] **Step 3: Add the list helper**

Create `apps/api/src/lib/list-accessible-orgs.ts`:

```ts
import { OrgMemberRepo, OrgRepo } from '@shared/db';
import type { Org } from '@shared/schemas';
import type { AuthContext } from '../middlewares/auth';

/** Orgs the caller owns plus the ones they were added to by email (#333). */
export async function listAccessibleOrgs(auth: AuthContext): Promise<Org[]> {
  const memberOrgIds = await OrgMemberRepo.listOrgIdsByEmail(auth.email.toLowerCase());
  return OrgRepo.findAccessible(auth.userId, memberOrgIds);
}
```

- [ ] **Step 4: Add `role` to the response schema**

In `apps/api/src/schemas/core.ts`, import `ORG_ROLES` alongside the others and add to `Organization`, after `billing_tier`:

```ts
    // owner = orgs.user_id; member = added by email (#333). Only billing and
    // team management are owner-only; the client does not gate anything else.
    role: z.enum(ORG_ROLES),
```

- [ ] **Step 5: Update the routes**

In `apps/api/src/routes/core.ts`:

- import `listAccessibleOrgs` from `'../lib/list-accessible-orgs'`; drop the `OrgRepo` import if nothing else in the file uses it.
- `/organizations` handler:

```ts
    async (c) => {
      const auth = c.get('auth');
      const orgs = await listAccessibleOrgs(auth);
      return c.json({
        organizations: orgs.map((o) => ({
          id: o.id,
          website_url: o.website_url,
          setup_status: o.setup_status,
          name: o.name,
          capabilities: {
            keyword_research: isPaid(o),
            keyword_scheduling: isPaid(o),
          },
          billing_tier: o.plan,
          role: o.user_id === auth.userId ? ('owner' as const) : ('member' as const),
        })),
      });
    },
```

- `/status` handler:

```ts
    async (c) => {
      const orgs = await listAccessibleOrgs(c.get('auth'));
      const setup_complete = orgs.some((o) => o.setup_status === 'setup_complete');
      return c.json({ setup_complete });
    },
```

- [ ] **Step 6: Run core tests, then the web typecheck**

Run: `npm test -- core.test && npm run lint:fix && npm run check:all`
Expected: core PASS. `check:web` may now fail where web tests construct a `ProductOrganization` without `role`; that is fixed in Task 7. If `check:all` fails only in `apps/web/tests/*.tsx` on a missing `role`, proceed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/list-accessible-orgs.ts apps/api/src/schemas/core.ts apps/api/src/routes/core.ts apps/api/tests/core.test.ts
git commit -m "api: organizations list and status include member orgs; role per org

Part of #333

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `/core/members` routes

**Files:**
- Create: `apps/api/src/schemas/members.ts`
- Create: `apps/api/src/routes/members.ts`
- Modify: `apps/api/src/routes/index.ts`
- Create: `apps/api/tests/members.test.ts`

**Interfaces:**
- Consumes: `loadOrgForUser`, `OrgMemberRepo`, `UserRepo.findById`.
- Produces (for the web client): `api.api.v0.core.members.$get({ query: { org_id } })` → `{ members: { email, role, created_at }[] }`; `$post({ json: { org_id, email } })` → 201 `{ email, role, created_at }` | 403 | 409 `{ error: 'already_member' }`; `$delete({ json: { org_id, email } })` → 200 `{ ok: true }` | 403 | 404.

- [ ] **Step 1: Write the failing route tests**

Create `apps/api/tests/members.test.ts`:

```ts
import type { Context, Next } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthEnv } from '../src/middlewares/auth';

const { findById, findUserById, members } = vi.hoisted(() => ({
  findById: vi.fn(),
  findUserById: vi.fn(),
  members: {
    listByOrgId: vi.fn(),
    findByOrgAndEmail: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  UserRepo: { findById: findUserById },
  OrgMemberRepo: members,
}));

// Two callers: the owner and a teammate. Swap via `caller` before each request.
let caller = { userId: 'owner', email: 'owner@example.com' };
vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: Context<AuthEnv>, next: Next) => {
      c.set('auth', caller);
      await next();
    },
  };
});

import { OpenAPIHono } from '@hono/zod-openapi';
import members from '../src/routes/members';

// Mount under a prefix so the typed client exposes `client.members.$get` etc.
const app = new OpenAPIHono().route('/members', members);
const client = testClient(app);
const now = new Date('2026-09-01T00:00:00.000Z');
const org = {
  id: 'o1',
  user_id: 'owner',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  plan: 'free',
  strategy_status: 'none',
  created_at: now,
};
const mateRow = { id: 'm1', org_id: 'o1', email: 'mate@example.com', invited_by: 'owner', created_at: now };

beforeEach(() => {
  vi.clearAllMocks();
  caller = { userId: 'owner', email: 'owner@example.com' };
  findById.mockResolvedValue(org);
  findUserById.mockResolvedValue({ id: 'owner', email: 'owner@example.com', google_sub: 'g', created_at: now });
  members.listByOrgId.mockResolvedValue([mateRow]);
  // Owner never hits org_members; a teammate matches; anyone else does not.
  members.findByOrgAndEmail.mockImplementation(async (_org: string, email: string) =>
    email === 'mate@example.com' ? mateRow : null,
  );
});

describe('GET /core/members', () => {
  test('owner sees the roster, owner row first', async () => {
    const res = await client.members.$get({ query: { org_id: 'o1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      members: [
        { email: 'owner@example.com', role: 'owner', created_at: now.toISOString() },
        { email: 'mate@example.com', role: 'member', created_at: now.toISOString() },
      ],
    });
  });

  test('a member sees the same roster', async () => {
    caller = { userId: 'mate', email: 'Mate@example.com' };
    const res = await client.members.$get({ query: { org_id: 'o1' } });
    expect(res.status).toBe(200);
    expect((await res.json()).members).toHaveLength(2);
  });

  test('404 for a stranger', async () => {
    caller = { userId: 'x', email: 'x@example.com' };
    const res = await client.members.$get({ query: { org_id: 'o1' } });
    expect(res.status).toBe(404);
  });
});

describe('POST /core/members', () => {
  test('owner adds a member (201, lowercased)', async () => {
    members.add.mockResolvedValueOnce({ ...mateRow, email: 'new@example.com' });
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'New@Example.com' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      email: 'new@example.com',
      role: 'member',
      created_at: now.toISOString(),
    });
    expect(members.add).toHaveBeenCalledWith({
      org_id: 'o1',
      email: 'new@example.com',
      invited_by: 'owner',
    });
  });

  test('403 for a member', async () => {
    caller = { userId: 'mate', email: 'mate@example.com' };
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'new@example.com' } });
    expect(res.status).toBe(403);
    expect(members.add).not.toHaveBeenCalled();
  });

  test("409 for the owner's own email", async () => {
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'Owner@example.com' } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'already_member' });
    expect(members.add).not.toHaveBeenCalled();
  });

  test('409 when the row already exists', async () => {
    members.add.mockResolvedValueOnce(null);
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'mate@example.com' } });
    expect(res.status).toBe(409);
  });

  test('404 for a stranger', async () => {
    caller = { userId: 'x', email: 'x@example.com' };
    const res = await client.members.$post({ json: { org_id: 'o1', email: 'new@example.com' } });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /core/members', () => {
  test('owner removes a member', async () => {
    members.remove.mockResolvedValueOnce(true);
    const res = await client.members.$delete({ json: { org_id: 'o1', email: 'mate@example.com' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(members.remove).toHaveBeenCalledWith('o1', 'mate@example.com');
  });

  test('404 when no such member', async () => {
    members.remove.mockResolvedValueOnce(false);
    const res = await client.members.$delete({ json: { org_id: 'o1', email: 'nobody@example.com' } });
    expect(res.status).toBe(404);
  });

  test('403 for a member', async () => {
    caller = { userId: 'mate', email: 'mate@example.com' };
    const res = await client.members.$delete({ json: { org_id: 'o1', email: 'mate@example.com' } });
    expect(res.status).toBe(403);
    expect(members.remove).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npm test -- members.test`
Expected: FAIL, cannot resolve `../src/routes/members`.

- [ ] **Step 3: Write the schemas**

Create `apps/api/src/schemas/members.ts`:

```ts
import { z } from '@hono/zod-openapi';
import { ORG_ROLES } from '@shared/types';

const ORG_ID = z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' });

export const MembersQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const Member = z
  .object({
    email: z.string(),
    role: z.enum(ORG_ROLES),
    /** ISO timestamp: org creation for the owner, the add for a member. */
    created_at: z.string(),
  })
  .openapi('Member');
export type Member = z.infer<typeof Member>;

export const MembersResponse = z.object({ members: z.array(Member) }).openapi('MembersResponse');

export const MemberBody = z
  .object({
    org_id: ORG_ID,
    email: z.string().trim().email().max(254).openapi({ example: 'teammate@example.com' }),
  })
  .openapi('MemberBody');

export const AlreadyMemberResponse = z
  .object({ error: z.literal('already_member') })
  .openapi('AlreadyMemberResponse');

export const OwnerOnlyResponse = z
  .object({ error: z.literal('Owner only') })
  .openapi('MembersOwnerOnlyResponse');

export const NotFoundResponse = z
  .object({ error: z.literal('Not found') })
  .openapi('MembersNotFoundResponse');

export const RemovedResponse = z.object({ ok: z.literal(true) }).openapi('MemberRemovedResponse');
```

- [ ] **Step 4: Write the router**

Create `apps/api/src/routes/members.ts`:

```ts
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { OrgMemberRepo, UserRepo } from '@shared/db';
import { loadOrgForUser } from '../lib/load-org-for-user';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/members';

/**
 * Org roster (#333). Reads are open to owner and members; add/remove are
 * owner-only. Membership is by email — no invite mail is sent; the teammate
 * simply logs in with Google using that address.
 */
const members = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['members'],
      method: 'get',
      path: '/',
      summary: 'List the owner and members of an org',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: { query: schemas.MembersQuery },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.MembersResponse } },
          description: 'Owner first, then members oldest-first',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not found or not accessible',
        },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('query');
      const access = await loadOrgForUser(org_id, c.get('auth'));
      if (!access) return c.json({ error: 'Not found' as const }, 404);
      const { org } = access;
      const [owner, rows] = await Promise.all([
        UserRepo.findById(org.user_id),
        OrgMemberRepo.listByOrgId(org.id),
      ]);
      const ownerRow = owner
        ? [{ email: owner.email, role: 'owner' as const, created_at: org.created_at.toISOString() }]
        : [];
      return c.json(
        {
          members: [
            ...ownerRow,
            ...rows.map((m) => ({
              email: m.email,
              role: 'member' as const,
              created_at: m.created_at.toISOString(),
            })),
          ],
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['members'],
      method: 'post',
      path: '/',
      summary: 'Add a member by email (owner only)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.MemberBody } }, required: true },
      },
      responses: {
        201: {
          content: { 'application/json': { schema: schemas.Member } },
          description: 'Member added',
        },
        403: {
          content: { 'application/json': { schema: schemas.OwnerOnlyResponse } },
          description: 'Caller is a member, not the owner',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not found or not accessible',
        },
        409: {
          content: { 'application/json': { schema: schemas.AlreadyMemberResponse } },
          description: 'The email is the owner or already a member',
        },
      },
    }),
    async (c) => {
      const { org_id, email } = c.req.valid('json');
      const auth = c.get('auth');
      const access = await loadOrgForUser(org_id, auth);
      if (!access) return c.json({ error: 'Not found' as const }, 404);
      if (access.role !== 'owner') return c.json({ error: 'Owner only' as const }, 403);
      const normalized = email.toLowerCase();
      if (normalized === auth.email.toLowerCase()) {
        return c.json({ error: 'already_member' as const }, 409);
      }
      const row = await OrgMemberRepo.add({ org_id, email: normalized, invited_by: auth.userId });
      if (!row) return c.json({ error: 'already_member' as const }, 409);
      return c.json(
        { email: row.email, role: 'member' as const, created_at: row.created_at.toISOString() },
        201,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['members'],
      method: 'delete',
      path: '/',
      summary: 'Remove a member (owner only)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.MemberBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.RemovedResponse } },
          description: 'Removed',
        },
        403: {
          content: { 'application/json': { schema: schemas.OwnerOnlyResponse } },
          description: 'Caller is a member, not the owner',
        },
        404: {
          content: { 'application/json': { schema: schemas.NotFoundResponse } },
          description: 'Org not accessible, or no such member',
        },
      },
    }),
    async (c) => {
      const { org_id, email } = c.req.valid('json');
      const access = await loadOrgForUser(org_id, c.get('auth'));
      if (!access) return c.json({ error: 'Not found' as const }, 404);
      if (access.role !== 'owner') return c.json({ error: 'Owner only' as const }, 403);
      const removed = await OrgMemberRepo.remove(org_id, email);
      if (!removed) return c.json({ error: 'Not found' as const }, 404);
      return c.json({ ok: true as const }, 200);
    },
  );

export default members;
```

- [ ] **Step 5: Mount it**

In `apps/api/src/routes/index.ts`, import `members from './members'` (alphabetical, after `keywords`) and add to the chain right after the `core` line:

```ts
  .route(`/api/${API_VERSION}/core/members`, members)
```

- [ ] **Step 6: Run the tests, lint, typecheck**

Run: `npm test -- members.test && npm run lint:fix && npm run check:all`
Expected: PASS (11 tests), clean (apart from the web `role` gap noted in Task 5 if it exists).

Sanity check the OpenAPI output builds: `npm test -- apps/api` should still pass everything except the php test.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/members.ts apps/api/src/schemas/members.ts apps/api/src/routes/index.ts apps/api/tests/members.test.ts
git commit -m "api: /core/members list, add, remove

Part of #333

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Team tab in settings

**Files:**
- Modify: `apps/web/lib/organizations.ts`
- Modify: `apps/web/lib/dashboard-query-keys.ts`
- Create: `apps/web/app/[locale]/(authenticated)/(product)/settings/_components/TeamPanel.tsx`
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/settings/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/tr.json`
- Create: `apps/web/tests/team-panel.test.tsx`
- Modify: any web test whose `ProductOrganization` literal now fails to typecheck (at least `apps/web/tests/organization-switcher.test.tsx`)

**Interfaces:**
- Consumes: the `/core/members` client surface from Task 6; `role` on the organizations response from Task 5.
- Produces: `dashboardQueryKeys.members(orgId)`; `TeamPanel({ organization, onUnauthorized })`.

- [ ] **Step 1: Add `role` to the web org type and the query key**

In `apps/web/lib/organizations.ts` add to the `ProductOrganization` type, after `name?: string;`:

```ts
  // owner = created it; member = added by email (#333). Only the Team tab
  // and nothing else in the shell reads this.
  role: OrgRole;
```

and extend the type import: `import type { EntitlementPlan, OrgRole, SetupStatus } from '@shared/schemas';`.

In `apps/web/lib/dashboard-query-keys.ts` add after `gscStatus`:

```ts
  members: (organizationId: string) =>
    [...dashboardQueryKeys.organization(organizationId), 'members'] as const,
```

Run `npm run check:web`; add `role: 'owner'` to every `ProductOrganization` literal it reports (the `org()` helper in `organization-switcher.test.tsx` and any others).

- [ ] **Step 2: Add the messages**

In `apps/web/messages/en.json` under `SettingsPage`:

- `tabs` gets `"team": "Team"` (keep keys alphabetical within the object).
- a new `"team"` block:

```json
"team": {
  "add": "Add",
  "adding": "Adding...",
  "alreadyMember": "That email is already on the team.",
  "description": "Teammates you add here can use everything in this workspace except billing and this team list. They sign in with Google using the email you enter.",
  "emailLabel": "Teammate email",
  "emailPlaceholder": "name@company.com",
  "error": "Something went wrong. Please try again.",
  "listError": "Could not load the team.",
  "loading": "Loading the team...",
  "member": "Member",
  "owner": "Owner",
  "ownerOnly": "Only the owner can add or remove teammates.",
  "remove": "Remove",
  "title": "Team"
}
```

In `apps/web/messages/tr.json` the same shape:

```json
"team": {
  "add": "Ekle",
  "adding": "Ekleniyor...",
  "alreadyMember": "Bu e-posta zaten ekipte.",
  "description": "Buraya eklediğiniz ekip arkadaşları, faturalandırma ve bu ekip listesi dışında bu çalışma alanındaki her şeyi kullanabilir. Girdiğiniz e-posta ile Google üzerinden giriş yaparlar.",
  "emailLabel": "Ekip arkadaşı e-postası",
  "emailPlaceholder": "isim@sirket.com",
  "error": "Bir şeyler ters gitti. Lütfen tekrar deneyin.",
  "listError": "Ekip yüklenemedi.",
  "loading": "Ekip yükleniyor...",
  "member": "Üye",
  "owner": "Sahip",
  "ownerOnly": "Ekip arkadaşlarını yalnızca sahip ekleyebilir veya kaldırabilir.",
  "remove": "Kaldır",
  "title": "Ekip"
}
```

and `"team": "Ekip"` in `tabs`.

Run: `npm test -- messages`
Expected: PASS (parity holds).

- [ ] **Step 3: Write the failing component test**

Create `apps/web/tests/team-panel.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProductOrganization } from '../lib/organizations';
import messages from '../messages/en.json';

const membersGet = vi.hoisted(() => vi.fn());
const membersPost = vi.hoisted(() => vi.fn());
const membersDelete = vi.hoisted(() => vi.fn());

vi.mock('@/lib/api', () => ({
  api: {
    api: {
      v0: {
        core: {
          members: { $get: membersGet, $post: membersPost, $delete: membersDelete },
        },
      },
    },
  },
}));

const { TeamPanel } = await import(
  '../app/[locale]/(authenticated)/(product)/settings/_components/TeamPanel'
);

function apiResponse(status: number, body: unknown = {}) {
  return { ok: status < 400, status, json: async () => body };
}

const roster = {
  members: [
    { email: 'owner@example.com', role: 'owner', created_at: '2026-09-01T00:00:00.000Z' },
    { email: 'mate@example.com', role: 'member', created_at: '2026-09-02T00:00:00.000Z' },
  ],
};

function org(role: ProductOrganization['role']): ProductOrganization {
  return {
    billing_tier: 'free',
    capabilities: { keyword_research: false, keyword_scheduling: false },
    id: 'org-1',
    name: 'Org',
    role,
    setup_status: 'setup_complete',
    website_url: 'https://example.com',
  };
}

function renderPanel(role: ProductOrganization['role']) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>
        <TeamPanel organization={org(role)} onUnauthorized={vi.fn()} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
  return { invalidateQueries, user: userEvent.setup() };
}

beforeEach(() => {
  vi.clearAllMocks();
  membersGet.mockResolvedValue(apiResponse(200, roster));
});

describe('TeamPanel', () => {
  test('owner sees the roster with add and remove controls', async () => {
    const { user, invalidateQueries } = renderPanel('owner');

    expect(await screen.findByText('owner@example.com')).toBeTruthy();
    expect(screen.getByText('mate@example.com')).toBeTruthy();
    // One Remove per member row, none for the owner.
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
    expect(screen.queryByText('Only the owner can add or remove teammates.')).toBeNull();

    membersPost.mockResolvedValueOnce(
      apiResponse(201, { email: 'new@example.com', role: 'member', created_at: '2026-09-03T00:00:00.000Z' }),
    );
    await user.type(screen.getByLabelText('Teammate email'), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(membersPost).toHaveBeenCalledWith({ json: { org_id: 'org-1', email: 'new@example.com' } }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'organization', 'org-1', 'members'],
    });
    expect((screen.getByLabelText('Teammate email') as HTMLInputElement).value).toBe('');
  });

  test('owner sees the already-member message on 409', async () => {
    const { user } = renderPanel('owner');
    await screen.findByText('mate@example.com');

    membersPost.mockResolvedValueOnce(apiResponse(409, { error: 'already_member' }));
    await user.type(screen.getByLabelText('Teammate email'), 'mate@example.com');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByText('That email is already on the team.')).toBeTruthy();
  });

  test('owner removes a member', async () => {
    const { user, invalidateQueries } = renderPanel('owner');
    await screen.findByText('mate@example.com');

    membersDelete.mockResolvedValueOnce(apiResponse(200, { ok: true }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(membersDelete).toHaveBeenCalledWith({ json: { org_id: 'org-1', email: 'mate@example.com' } }),
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['dashboard', 'organization', 'org-1', 'members'],
    });
  });

  test('member sees the roster read-only', async () => {
    renderPanel('member');

    expect(await screen.findByText('owner@example.com')).toBeTruthy();
    expect(screen.queryByLabelText('Teammate email')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByText('Only the owner can add or remove teammates.')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run to see it fail**

Run: `npm test -- team-panel`
Expected: FAIL, cannot resolve `TeamPanel`.

- [ ] **Step 5: Write the panel**

Create `apps/web/app/[locale]/(authenticated)/(product)/settings/_components/TeamPanel.tsx`:

```tsx
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, useState } from 'react';
import { Badge, Button, Input, Label, StatusPanel } from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import type { ProductOrganization } from '@/lib/organizations';

type Member = { email: string; role: 'owner' | 'member'; created_at: string };

/**
 * Settings → Team (#333). Everyone on the org sees the roster; only the owner
 * gets the add form and the remove buttons. No invite mail is sent: the owner
 * adds an email and the teammate signs in with Google using it.
 */
export function TeamPanel({
  onUnauthorized,
  organization,
}: {
  onUnauthorized: () => void;
  organization: ProductOrganization | null;
}) {
  const t = useTranslations('SettingsPage.team');
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [addError, setAddError] = useState<'already_member' | 'failed' | null>(null);
  const isOwner = organization?.role === 'owner';

  const membersQuery = useQuery({
    queryKey: dashboardQueryKeys.members(organization?.id ?? ''),
    queryFn: async (): Promise<Member[]> => {
      if (!organization) return [];
      const response = await api.api.v0.core.members.$get({ query: { org_id: organization.id } });
      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }
      if (!response.ok) throw new Error('members_failed');
      return (await response.json()).members;
    },
    enabled: Boolean(organization),
  });

  const invalidate = () => {
    if (!organization) return;
    void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.members(organization.id) });
  };

  const addMutation = useMutation({
    mutationFn: async (value: string) => {
      if (!organization) throw new Error('organization_required');
      const response = await api.api.v0.core.members.$post({
        json: { org_id: organization.id, email: value },
      });
      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }
      if ((response.status as number) === 409) throw new Error('already_member');
      if (!response.ok) throw new Error('add_failed');
      return response.json();
    },
    onSuccess: () => {
      setEmail('');
      setAddError(null);
      invalidate();
    },
    onError: (error: Error) => {
      if (error.message === 'unauthorized') return;
      setAddError(error.message === 'already_member' ? 'already_member' : 'failed');
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (value: string) => {
      if (!organization) throw new Error('organization_required');
      const response = await api.api.v0.core.members.$delete({
        json: { org_id: organization.id, email: value },
      });
      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }
      if (!response.ok) throw new Error('remove_failed');
      return response.json();
    },
    onSuccess: invalidate,
  });

  function submitAdd(event: FormEvent<HTMLFormElement>) {
    // The panel lives inside the settings <form>; stop this submit from
    // reaching it and from reloading the page.
    event.preventDefault();
    event.stopPropagation();
    const value = email.trim();
    if (!value || addMutation.isPending) return;
    setAddError(null);
    addMutation.mutate(value);
  }

  const removeFailed =
    removeMutation.isError && (removeMutation.error as Error | null)?.message !== 'unauthorized';

  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-4">
      <p className="text-muted-foreground text-sm">{t('description')}</p>

      {isOwner ? (
        <form className="grid gap-2 sm:flex sm:items-end" onSubmit={submitAdd}>
          <div className="grid flex-1 gap-2">
            <Label htmlFor="team-email">{t('emailLabel')}</Label>
            <Input
              id="team-email"
              type="email"
              autoComplete="off"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <Button type="submit" disabled={!organization || !email.trim() || addMutation.isPending}>
            {addMutation.isPending ? t('adding') : t('add')}
          </Button>
        </form>
      ) : (
        <p className="text-muted-foreground text-sm">{t('ownerOnly')}</p>
      )}

      {addError === 'already_member' ? (
        <StatusPanel tone="warning">{t('alreadyMember')}</StatusPanel>
      ) : addError === 'failed' || removeFailed ? (
        <StatusPanel tone="error">{t('error')}</StatusPanel>
      ) : null}

      {membersQuery.isPending ? (
        <p className="text-muted-foreground text-sm">{t('loading')}</p>
      ) : membersQuery.isError ? (
        <StatusPanel tone="error">{t('listError')}</StatusPanel>
      ) : (
        <ul className="grid gap-2">
          {membersQuery.data.map((member) => (
            <li
              key={member.email}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="truncate">{member.email}</span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge variant={member.role === 'owner' ? 'default' : 'secondary'}>
                  {member.role === 'owner' ? t('owner') : t('member')}
                </Badge>
                {isOwner && member.role === 'member' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-error hover:text-error"
                    disabled={removeMutation.isPending}
                    onClick={() => removeMutation.mutate(member.email)}
                  >
                    {t('remove')}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

Check `apps/web/components/ui/badge.tsx` for the variant names; if `secondary` does not exist, use `outline` (or whichever muted variant the file defines).

A nested `<form>` inside the settings page `<form>` is invalid HTML. To avoid it, the settings page must render the Team panel **outside** its `<form>`. Step 6 handles that.

- [ ] **Step 6: Wire the tab into the settings page**

In `apps/web/app/[locale]/(authenticated)/(product)/settings/page.tsx`:

- import: `import { TeamPanel } from './_components/TeamPanel';`
- `settingsTabs` becomes:

```ts
const settingsTabs = [
  'business',
  'audienceCompetitors',
  'integrations',
  'googleSearchConsole',
  'team',
] as const;
```

- The whole page currently returns one `<form>`. Change the return so the tab strip and the four existing panels stay inside the `<form>` and the Team panel sits after it, as a sibling, in a fragment:

```tsx
  return (
    <>
      <form className="grid w-full gap-4" onSubmit={saveSettings}>
        {/* ...existing content unchanged... */}
      </form>

      <div
        id="settings-panel-team"
        role="tabpanel"
        aria-labelledby="settings-tab-team"
        hidden={activeTab !== 'team'}
        className="mt-4"
      >
        <TeamPanel organization={organization} onUnauthorized={handleUnauthorized} />
      </div>
    </>
  );
```

`SAVEABLE_TABS` is untouched, so the Save button is hidden on the Team tab.

- [ ] **Step 7: Run the component test, lint, typecheck**

Run: `npm test -- team-panel && npm run lint:fix && npm run check:all`
Expected: PASS (4 tests), clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "web: Team tab in settings — roster, add and remove members

Part of #333

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: CLI sweep, docs, follow-up issues, final verification

**Files:**
- Modify: `apps/cli/src/lib/db.ts`, `apps/cli/src/types.ts`
- Modify: `PROGRESS.md`
- Modify: `docs/superpowers/specs/2026-09-05-org-membership-design.md` (two clarifications)

- [ ] **Step 1: Count members in both delete sweeps**

In `apps/cli/src/lib/db.ts`:

- add `OrgMemberRepo` to the `@shared/db` import list (alphabetical, after `KeywordRepo`).
- in `wipeUser` (around line 513) add `members: 0,` to the `deleted` object and, inside the loop before `OrgRepo.deleteById`, add:

```ts
    deleted.members += await OrgMemberRepo.deleteByOrgId(org.id);
```

- in `deleteOrgs` (around line 608) add `members: 0,` to its `deleted` object and, inside its loop before the org doc deletion, add:

```ts
      deleted.members += await OrgMemberRepo.deleteByOrgId(id);
```

In `apps/cli/src/types.ts` add `members: number;` to both `ResetUserData.deleted` and `DeleteOrgData.deleted`.

Run: `npm run lint:fix && npm run check:all`
Expected: clean.

- [ ] **Step 2: File the two follow-up issues**

```bash
gh issue create --label backend --title "[backend] Send real invite emails for org membership" --body "$(cat <<'EOF'
Follow-up to #333. Today an owner adds a teammate's email in Settings → Team and the org appears for whoever logs in with that Google account; no mail is sent, the owner tells them out of band.

Scope for a real invite flow:
- A mail provider in the API stack (SES or similar) with a verified sender domain per environment.
- An invite token + expiry, an accept endpoint, and an accept page in the web app.
- Keep "add by email" as the baseline; the email is a courtesy, not the source of access.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh issue create --label backend --title "[backend] Org roles beyond owner/member" --body "$(cat <<'EOF'
Follow-up to #333. Membership ships with two derived roles: owner (`orgs.user_id`) and member (`org_members` row). Members can do everything except billing and team management.

Scope for finer roles:
- A `role` column on `org_members` (viewer / editor / admin or similar) and per-route checks where they matter (settings, integrations, article deletion).
- Hide the billing tab and checkout controls for non-owners in the web app (today they get the API 403 in the existing error state).
- Owner transfer.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note both issue numbers for the next step.

- [ ] **Step 3: Update PROGRESS.md**

Under `## Core / auth`, after the #127 line, add (with the two numbers from Step 2 in place of `EMAIL` and `ROLES`):

```markdown
- ✅ Org membership — owner adds teammates by email (`org_members`, no invite mail), `GET/POST/DELETE /core/members`, Team tab in settings; members can do everything except billing and team management — [#333](https://github.com/seopotion/seo/issues/333). Real invite emails: [#EMAIL](https://github.com/seopotion/seo/issues/EMAIL); finer roles: [#ROLES](https://github.com/seopotion/seo/issues/ROLES)
```

- [ ] **Step 4: Record two refinements in the spec**

In `docs/superpowers/specs/2026-09-05-org-membership-design.md`, "Authorization" section:

After the `loadOrgForUser` signature block, add:

```markdown
A sibling `loadAccessibleOrg(org_id, auth)` returns just the `Org` (or null) so the
~50 routes that never look at the role migrate by a pure rename; only billing
and the members routes call `loadOrgForUser`.
```

Replace the paragraph that begins "`loadOwnedPaidOrg` (`load-owned-paid-org.ts`) takes the same `auth` object" with:

```markdown
`loadOwnedPaidOrg` (`load-owned-paid-org.ts`) takes the same `auth` object and
uses `loadOrgForUser`; a missing or inaccessible org is `not_found` (404) like
every other route, so the old `not_owner` reason and its 403 are gone. The file
keeps its name.
```

Also update the "Error handling" table row `paid gate for a member of an unpaid org` to read `402 (same as owner); a stranger gets 404`, and the Testing bullet for `load-owned-paid-org.test.ts` to say `not_found for a stranger`.

- [ ] **Step 5: Full verification**

Run:

```bash
npm run lint && npm run check:all && npm test
```

Expected: lint clean, typecheck clean, all tests pass except `wordpress-plugin-behavior.test.ts` (php, local-only). Confirm the package-lock has no diff (`git status --short package-lock.json` prints nothing; memory: macOS npm prunes `@emnapi`).

- [ ] **Step 6: Commit**

```bash
git add apps/cli PROGRESS.md docs/superpowers/specs/2026-09-05-org-membership-design.md
git commit -m "cli: delete-org sweeps org_members; docs for #333

Part of #333

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

- [ ] **Step 7: Open the PR**

Push the branch and open a PR into `dev`:

```bash
git push -u origin HEAD
gh pr create --base dev --title "[backend] Org membership: teammates by email, Team tab" --body "$(cat <<'EOF'
Closes #333

Owners add teammates by email in Settings → Team. A teammate logs in with Google and the org shows up in their switcher; they can do everything except billing and team management.

- `org_members` collection (`org_id`, `email`, `invited_by`), unique `(org_id, email)`, index on `email`. `orgs.user_id` stays the owner — no migration.
- `loadOrgForUser` / `loadAccessibleOrg` replace `loadOwnedOrg`; the paid gate accepts members and answers 404 (not 403) for strangers.
- `GET /core/organizations` and `/core/status` include member orgs; each org carries `role`.
- `GET/POST/DELETE /core/members`; billing checkout, portal and promo validation return 403 for members.
- Team tab in settings (roster for everyone, add/remove for the owner).
- `db delete-org` / `reset-user` sweep `org_members`.

Design: `docs/superpowers/specs/2026-09-05-org-membership-design.md`. Plan: `docs/superpowers/plans/2026-09-05-org-membership.md`.

Follow-ups: real invite emails and finer roles (issues filed, linked from PROGRESS.md).

Staging check after merge: run `seo-dev db init` (new indexes), add a second Google account to clewas, log in as it, confirm the org appears, the Team tab is read-only, checkout returns 403; remove it and confirm the org disappears.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
