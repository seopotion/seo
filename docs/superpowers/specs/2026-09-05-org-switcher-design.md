# Multiple orgs per account + org switcher — design

_Issue: [#127](https://github.com/seopotion/seo/issues/127). Date: 2026-09-05._

## Goal

One login can own several organizations (an org is one website, see
`design/product-flow.md`), pick which one the product shell shows, and add
another website from inside the product. Billing stays per org: every org has
its own plan, subscription and checkout. The switcher lives only inside the
product shell; the marketing navbar is untouched.

Out of scope: teammates / membership (a separate follow-up issue; see
"Teams later"), account-level billing, org rename or deletion from the product,
resuming an abandoned in-progress org from the switcher.

## What already works

The backend is multi-org today. Every org-scoped route takes `org_id` from the
client (query param on GETs, body on writes) and checks ownership in
`apps/api/src/lib/load-owned-org.ts`. The JWT carries only `{ sub, email }`.
`GET /core/organizations` returns every org the user owns; `POST
/setup/start_scan` creates another org for a user who already has one, reusing
an in-progress org for the same URL. The `orgs` index on `(user_id,
website_url)` is not unique. Subscriptions are keyed by `org_id`. Worker,
strategy and article pipelines are `org_id`-driven. react-query keys under
`dashboardQueryKeys.organization(id)` are already namespaced per org.

**No backend change is needed.** `GET /core/status` keeps its meaning: "does
this user have at least one `setup_complete` org". That is still the right
gate for the product shell, because the switcher only ever selects completed
orgs (below).

## The single-org assumption, and where it breaks

| Site | Today | Change |
|---|---|---|
| `apps/web/lib/organizations.ts` `selectActiveOrganization` | first `setup_complete` org, else first org | honour a stored preference first |
| `useActiveOrganization` / `getActiveOrganization` | no shared "which org" state | read the stored id; re-render on switch |
| `onboarding/page.tsx` workspace gate | `setupComplete` → redirect to `/home` | skip the redirect in "add website" mode |
| `onboarding/page.tsx` finalize | `router.replace('/home')` | first make the new org active and drop the cached org list |
| `ProductShell.tsx` | no user menu; header has locale + logout | add the switcher to the sidebar |
| `ProductShell.tsx` `logout` | clears token + status cache + queries | also clear the stored org id |
| GSC / GitHub OAuth callbacks | redirect to `/settings?tab=…` | make `body.org_id` the active org before redirecting |

## Design

### 1. Active-org store (`apps/web/lib/active-organization.ts`)

A tiny external store, read with `useSyncExternalStore`, backed by one
localStorage key `seo_active_org` next to the JWT's `seo_jwt`. This replaces a
context provider: nothing in the tree needs wrapping, and it keeps the existing
"react-query dedupes, no provider" rationale in `organizations.ts`.

```ts
export function getActiveOrganizationId(): string | null;   // localStorage read, null on server
export function setActiveOrganizationId(id: string): void;  // write + notify subscribers
export function clearActiveOrganizationId(): void;          // logout
export function useActiveOrganizationId(): string | null;   // useSyncExternalStore
```

`selectActiveOrganization(organizations, preferredId)` becomes a pure function:

1. the org whose `id === preferredId` **if** its `setup_status === 'setup_complete'`,
2. else the first `setup_complete` org,
3. else `organizations[0]`,
4. else `null`.

Rule 1's status check means a stored id that points at an abandoned scan, a
deleted org, or (later) an org the user was removed from falls through
silently. The stale value is harmless for exactly that reason — rule 1 falls
through on any id that does not name a `setup_complete` org — so there is no
cleanup pass.

The store reads localStorage once per page load and caches the result, so a
switch made in another tab is not seen here until this tab reloads. That is
deliberate: `useSyncExternalStore` re-reads the snapshot on every render, and
letting another tab's id land mid-session would move the shell to a different
org without the `router.replace('/home')` a deliberate switch pairs with,
stranding the user on a detail page of the org they just left.

`useActiveOrganization` passes `useActiveOrganizationId()` into `select`. Both
`ProductShell` and the page keep calling it; react-query still dedupes the
fetch, and a switch re-runs `select` on the cached list without a request.
`getActiveOrganization()` (imperative, used by billing checkout) reads the
store the same way.

### 2. Switcher (`apps/web/app/[locale]/(authenticated)/(product)/OrganizationSwitcher.tsx`)

Rendered in the sidebar, directly under the logo block, full width. Built on
the existing Radix `Select` primitive in `components/ui/select.tsx` (no new
dependency, no new primitive to hand-rewrite).

- Trigger shows the active org's `name` (fallback `website_url` host) and, in
  muted text, the host. Always rendered, even with one org, so "Add website"
  is discoverable.
- Items: every org with `setup_status === 'setup_complete'`, in the order the
  API returns them. In-progress orgs are not listed.
- A separator, then one item with the sentinel value `__add__` labelled "Add
  website". This is an owner action; it gets a single obvious place to gate
  once teams arrive.
- `onValueChange`:
  - org id → `setActiveOrganizationId(id)`, then `router.replace('/home')`.
    Navigating home is deliberate: pages like `/content-history/[articleId]`
    and `/analytics/[articleId]` carry an entity of the old org and would
    render "not found" under the new one. Query caches are per-org, so no
    invalidation is needed.
  - `__add__` → `router.push('/onboarding?new=1')`.

i18n: `ProductShell.switcher.label`, `ProductShell.switcher.addWebsite` in
`en.json` and `tr.json` (the messages parity test enforces both).

### 3. "Add website" mode in onboarding

`onboarding/page.tsx` reads `?new=1` once via
`new URLSearchParams(window.location.search)`, the way `settings/page.tsx`
reads `?tab=` (`useSearchParams` would force a Suspense boundary on this
statically prerendered page). When it is set:

- `checkWorkspaceGate` still checks auth and `status.ok`, but does not redirect
  to `/home` on `setupComplete`.
- A small "Back to dashboard" link (`/home`, key `Onboarding.backToDashboard`)
  is shown above the wizard, so a user who opened it by accident can leave. Nothing else in the wizard changes:
  the URL field starts empty, the scan runs, and `start_scan`'s per-URL
  idempotency already handles a retried URL.
- On finalize, after `completeOnboarding` succeeds and before
  `router.replace('/home')`:
  `setActiveOrganizationId(orgId)` and
  `queryClient.removeQueries({ queryKey: dashboardQueryKeys.organizations() })`.
  The removal matters because the org list is cached with a five-minute
  `staleTime`; without it the shell would mount with a list that lacks the new
  org and the selector would fall back to the old one.

The same two calls run in the non-add path too (harmless for a first org, and
one code path instead of two).

`ProductAccessGuard` is unchanged.

### 4. Logout and OAuth returns

- `clearToken()` in `lib/auth.ts` also calls `clearActiveOrganizationId()`.
  Every logout and 401 path (sixteen call sites) goes through `clearToken`, so
  one line covers them all.
- `dashboard/gsc/callback/page.tsx` calls `setActiveOrganizationId(body.org_id)`
  before redirecting to settings, so the settings page that opens is the org
  that was connected even if another tab switched during the OAuth round trip.
  The GitHub callback gets no such line: its exchange response carries no
  `org_id` (the id lives only in the signed state), and the stored value
  survives the round trip unchanged in the common case.

### 5. CLI, admin, docs

- `apps/cli/src/lib/target.ts` already fails `--user` with `AMBIGUOUS_ORG` and
  a hint to pass `--org`. No change.
- `PROGRESS.md` lines for #127 (dashboard and product UI sections) flip to
  done, one line each.
- `design/documentation-ia.md` lists multi-org switching under "hold, do not
  document". The user docs are not part of this change; that line is updated
  to point at this spec when the feature ships, and a docs page is a
  follow-up.

### Teams later

Nothing here compares `org.user_id` to the logged-in user on the client, and
nothing should: the org list from the API is the only source of "orgs I can
see". When membership lands, `loadOwnedOrg` becomes a membership check in one
file, `GET /core/organizations` returns member orgs, and the switcher needs no
change beyond gating "Add website" by role.

## Error handling

- Org list `401` → existing path (`clearToken`, redirect to `/`), plus
  `clearActiveOrganizationId()`.
- Org list unavailable → existing `error: 'unavailable'` state; the switcher
  renders nothing while `organization` is null.
- Stored id not in the list → fallback rules above, no error surfaced.
- Finalize succeeds but `router.replace` lands before the list refetch →
  `useActiveOrganization` shows `loading` until the refetch resolves, which is
  today's first-org behaviour.

## Testing

Vitest, `apps/web/tests/`, no DOM setup needed:

- `active-organization.test.ts`: `selectActiveOrganization` — preferred
  complete org wins; preferred id missing falls back to first complete;
  preferred id pointing at an in-progress org falls back; empty list → null.
  Store: set/get/clear round-trip with a stubbed `window.localStorage`;
  subscribers notified on set and clear; server-side read returns null.
- `messages.test.ts` already asserts en/tr parity; the new keys ride on it.
- Manual on staging: two orgs on one account (`clewas` + a fresh scan), switch
  both ways, reload persists, logout then login lands on the first complete
  org, "Add website" round-trip makes the new org active.

## Files

New: `apps/web/lib/active-organization.ts`,
`apps/web/app/[locale]/(authenticated)/(product)/OrganizationSwitcher.tsx`,
`apps/web/tests/active-organization.test.ts`.

Modified: `apps/web/lib/organizations.ts`, `apps/web/lib/auth.ts`,
`ProductShell.tsx`, `onboarding/page.tsx`, the GSC callback page, `messages/en.json`,
`messages/tr.json`, `PROGRESS.md`, `design/documentation-ia.md`.

One frontend PR into `dev`, `Closes #127`.
