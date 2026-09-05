# Org membership: teammates — design

_Issue: [#333](https://github.com/seopotion/seo/issues/333). Date: 2026-09-05.
Follow-up to [#127](https://github.com/seopotion/seo/issues/127) / the
[org switcher spec](2026-09-05-org-switcher-design.md)._

## Goal

An org owner can add teammates by email address. A teammate logs in with
Google as usual and the org appears in their switcher; inside it they can do
everything the owner can except manage billing and manage the team. Billing
stays per org.

## Decisions

- **Membership by email, no mail sent.** Login is Google-only, so every
  session carries a Google-verified email. The owner adds an email; the org
  becomes visible to whoever logs in with that email. No invite token, no
  accept step, no mail provider. The owner tells the teammate out of band.
  Real invite emails are deferred to a follow-up issue.
- **Two roles, derived.** `owner` is `orgs.user_id`; `member` is a row in
  `org_members`. Members can do everything except billing (checkout, portal,
  promo validate) and team management. Finer roles are a follow-up issue.
- **`orgs.user_id` stays the owner.** No migration, no change to the admin
  panel, CLI target resolution, `start_scan` idempotency or the worker.
- **"Add website" in the switcher is not gated.** Creating a website makes
  the creator the owner of a new org; nothing about it needs a role.
- **One PR**: backend, Team tab in settings, delete-org sweep. `Closes #333`.

## Data model

New entity `OrgMember` in `@shared/schemas` (`org-member.ts`):

```ts
export const OrgMemberSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  email: z.string().email(), // stored lowercased
  invited_by: z.string(),    // user id of the owner who added the row
  created_at: z.date(),
});
```

There is no `role` column: the owner is never in the collection, every row is
a member. `ORG_ROLES = ['owner', 'member'] as const` and `OrgRole` live in
`@shared/types` for the API response shape.

New `OrgMemberRepo` in `@shared/db` (`repositories/org-member.repo.ts`):

| Method | Purpose |
|---|---|
| `listByOrgId(org_id)` | roster, ordered by `created_at` |
| `findByOrgAndEmail(org_id, email)` | membership check |
| `listOrgIdsByEmail(email)` | "orgs I was added to" |
| `add({ org_id, email, invited_by })` | insert; a duplicate-key error surfaces as `null` so the route can answer 409 |
| `remove(org_id, email)` | `deleteOne`, returns boolean |
| `deleteByOrgId(org_id)` | delete-org sweep, returns count |

Emails are lowercased on the way in by the repo, so callers never have to.

Indexes in `ensureIndexes`:

```ts
await db.collection('org_members').createIndex({ org_id: 1, email: 1 }, { unique: true });
await db.collection('org_members').createIndex({ email: 1 });
```

`OrgRepo.findByUserId` is unchanged (the CLI and `start_scan` still mean
"owned"). New `OrgRepo.findAccessible(userId, email)` returns owned orgs plus
member orgs in one query:

```ts
const memberOrgIds = await OrgMemberRepo.listOrgIdsByEmail(email);
find({ $or: [{ user_id: userId }, { _id: { $in: memberOrgIds.map(toObjectId) } }] })
```

Owned orgs come first, then member orgs, each group by `created_at`; the
switcher renders the list in API order.

## Authorization

`apps/api/src/lib/load-owned-org.ts` becomes `load-org-for-user.ts`:

```ts
export type OrgAccess = { org: Org; role: OrgRole };

/** Null when the org is missing OR the caller is neither owner nor member —
 *  callers map both to 404 so org existence never leaks across accounts. */
export async function loadOrgForUser(
  org_id: string,
  auth: { userId: string; email: string },
): Promise<OrgAccess | null>;
```

A sibling `loadAccessibleOrg(org_id, auth)` returns just the `Org` (or null) so the
~50 routes that never look at the role migrate by a pure rename; only billing
and the members routes call `loadOrgForUser`.

Order of checks: `OrgRepo.findById`; if `org.user_id === auth.userId` return
`owner`; else `OrgMemberRepo.findByOrgAndEmail(org_id, auth.email)` and return
`member` if found; else null. The email from the JWT is lowercased before the
lookup.

Every call site (about 50 across `analytics`, `dashboard`, `gsc`,
`integrations`, `keywords`, `setup`, `billing`) changes mechanically:

```ts
// before
const { userId } = c.get('auth');
const org = await loadOwnedOrg(org_id, userId);
if (!org) return c.json({ error: 'Organization not found' }, 404);
// after
const access = await loadOrgForUser(org_id, c.get('auth'));
if (!access) return c.json({ error: 'Organization not found' }, 404);
const { org } = access;
```

Article- and keyword-keyed routes that today call
`loadOwnedOrg(article.org_id, userId)` do the same with `article.org_id`.

`loadOwnedPaidOrg` (`load-owned-paid-org.ts`) takes the same `auth` object and
uses `loadOrgForUser`; a missing or inaccessible org is `not_found` (404) like
every other route, so the old `not_owner` reason and its 403 are gone. The file
keeps its name.

Owner-only routes check `access.role !== 'owner'` and return
`403 { error: 'Owner only' }`: billing `POST /checkout`, `GET /portal`,
`POST /promo/validate`, and the members mutations below. No other route
looks at the role.

OAuth state for GSC and GitHub already pins the starting user's id and checks
it on callback; that stays. Membership only decides whether the user may act
on the org at all.

## API

New router `apps/api/src/routes/members.ts`, mounted in `routes/index.ts`
under `/core/members`, Bearer-protected, typed `OpenAPIHono<AuthEnv>`. Schemas
in `apps/api/src/schemas/members.ts`.

| Route | Who | Behaviour |
|---|---|---|
| `GET /core/members?org_id=` | owner or member | `{ members: [{ email, role, created_at }] }`, owner row first (email from `UserRepo.findById(org.user_id)`), then members by `created_at`. 404 if not accessible. |
| `POST /core/members` `{ org_id, email }` | owner | 403 for members. 409 `{ error: 'already_member' }` if the email is the owner's or already a member. 201 with the member row `{ email, role: 'member', created_at }`. |
| `DELETE /core/members` `{ org_id, email }` | owner | 403 for members. 404 if no such member. 200 `{ ok: true }`. |

Email in `POST` is validated with `z.string().email()` and lowercased by the
repo.

`GET /core/organizations` adds `role` to every item and reads
`OrgRepo.findAccessible(userId, email)`. `GET /core/status` reads
`findAccessible` too, so a user whose only org is a completed one they were
added to passes the product gate.

## Frontend

- `ProductOrganization` (`apps/web/lib/organizations.ts`) gains
  `role: 'owner' | 'member'`. Nothing else in the shell reads it; the switcher
  is untouched.
- `settingsTabs` in `settings/page.tsx` gets a fifth entry `team` after
  `googleSearchConsole`. It is not in `SAVEABLE_TABS`, so no Save button.
  Everyone sees the tab; only mutations are owner-gated.
- New `settings/_components/TeamPanel.tsx`, shaped like
  `GoogleSearchConsolePanel`: props `organization` and `onUnauthorized`,
  `useQuery` on `GET /core/members` under a new
  `dashboardQueryKeys.members(orgId)`, mutations for add and remove that
  invalidate that key on success.
  - Roster: one row per person, email plus a muted role label, owner first.
  - `organization.role === 'owner'`: an email input and "Add" button above the
    roster; a "Remove" button on each member row (never on the owner row).
    Add is disabled while pending or the input is not a valid email. A 409
    shows an inline "already a member" line; any other failure shows the
    generic error line. The input clears on success.
  - `organization.role === 'member'`: roster only, plus one sentence
    "Only the owner can manage the team".
- i18n: `SettingsPage.tabs.team` and `SettingsPage.team.{title,description,
  emailLabel,emailPlaceholder,add,remove,owner,member,alreadyMember,ownerOnly,
  error}` in `en.json` and `tr.json`. The parity test covers both.
- Billing tab: unchanged. A member who tries checkout gets the API 403 in the
  existing error state; hiding billing for members belongs to the roles
  follow-up.

## CLI and cleanup

- `db delete-org` (`apps/cli/src/lib/db.ts`, both delete paths) calls
  `OrgMemberRepo.deleteByOrgId` and reports a `members` count.
- `db delete-user` does not touch member rows. A deleted user's email left in
  another org's roster is inert; the owner removes it from the Team tab.
- No CLI add-member command; the Team tab is the tool.

## Error handling

| Case | Result |
|---|---|
| org missing or caller not owner/member | 404 on every org-scoped route (unchanged contract) |
| member calls an owner-only route | 403 `{ error: 'Owner only' }` |
| add an email that is the owner or already a member | 409 `{ error: 'already_member' }` |
| remove an email that is not a member | 404 |
| paid gate for a member of an unpaid org | 402 (same as owner); a stranger gets 404 |
| Team tab list 401 | existing `onUnauthorized` path |

## Testing

Vitest, no infra:

- `apps/api/tests/members.test.ts`: list as owner and as member (owner row
  first); add as owner 201; add as member 403; add duplicate 409; add the
  owner's own email 409; remove 200 then 404; list as non-member 404.
- `apps/api/tests/core.test.ts`: organizations items carry `role`; a member's
  org is listed with `role: 'member'`; status is `setup_complete: true` for a
  user whose only org is one they were added to.
- `apps/api/tests/billing.test.ts`: checkout as member returns 403.
- `apps/api/tests/load-owned-paid-org.test.ts`: new signature; a member
  passes the gate; `not_found` for a stranger.
- Existing route tests keep their `OrgRepo.findById` mocks; the `@shared/db`
  mock gains an `OrgMemberRepo` stub returning `null` so owner paths are
  unchanged.
- `apps/web/tests/team-panel.test.tsx` (jsdom `web-dom` project): owner sees
  the input and remove buttons; member sees neither and sees the owner-only
  sentence.
- Manual on staging: add a second Google account to `clewas`, log in as it,
  the org appears in the switcher and the product loads, the Team tab shows
  the roster without controls, billing checkout returns 403; remove it as the
  owner and confirm it no longer lists the org.

## Files

New: `packages/shared/schemas/src/org-member.ts`,
`packages/shared/db/src/repositories/org-member.repo.ts`,
`apps/api/src/lib/load-org-for-user.ts` (replaces `load-owned-org.ts`),
`apps/api/src/routes/members.ts`, `apps/api/src/schemas/members.ts`,
`apps/api/tests/members.test.ts`,
`apps/web/app/[locale]/(authenticated)/(product)/settings/_components/TeamPanel.tsx`,
`apps/web/tests/team-panel.test.tsx`.

Modified: `@shared/types` (`ORG_ROLES`), `@shared/schemas` index,
`@shared/db` index, `ensure-indexes.ts`, `org.repo.ts`,
`load-owned-paid-org.ts`, every route file that called `loadOwnedOrg`,
`routes/index.ts`, `schemas/core.ts`, `apps/web/lib/organizations.ts`,
`apps/web/lib/dashboard-query-keys.ts`, `settings/page.tsx`, `messages/en.json`,
`messages/tr.json`, `apps/cli/src/lib/db.ts`, `PROGRESS.md`, the affected API
tests.

## Follow-up issues

- `[backend] Send real invite emails` — mail provider, invite token, accept
  page; today's "add by email, tell them out of band" flow is the baseline.
- `[backend] Org roles beyond owner/member` — viewer/editor split, hide
  billing for members, per-route role checks.
