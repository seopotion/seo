# Org Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one login own several orgs, pick the active one from a sidebar switcher, and add another website from inside the product.

**Architecture:** Frontend only. A localStorage-backed external store (`useSyncExternalStore`) holds the active org id; `selectActiveOrganization` honours it when that org is `setup_complete`, else falls back to today's rule. The switcher is a Radix `Select` in the product sidebar; "Add website" opens `/onboarding?new=1`, which skips the redirect-to-home and, on finalize, makes the new org active. Spec: `docs/superpowers/specs/2026-09-05-org-switcher-design.md`.

**Tech Stack:** Next.js 16 app router, React `useSyncExternalStore`, @tanstack/react-query, Radix Select (`components/ui/select.tsx`), next-intl (`en`/`tr`), Vitest (node project for `.test.ts`), Biome.

## Global Constraints

- No backend change. `GET /core/status` and every API route stay as they are.
- localStorage key for the active org: `seo_active_org` (next to the JWT's `seo_jwt`).
- Add-website sentinel select value: `__add__`. Add-website URL: `/onboarding?new=1`.
- Switcher lists only orgs with `setup_status === 'setup_complete'`; switching always routes to `/home`.
- Every new i18n key goes into both `apps/web/messages/en.json` and `apps/web/messages/tr.json` (`tests/messages.test.ts` fails otherwise). `global.d.ts` types `t()` against `en.json`, so add the English key first.
- Read `?new=1` with `new URLSearchParams(window.location.search)` (the pattern `settings/page.tsx:244` uses), not `useSearchParams`, which would force a Suspense boundary on a statically prerendered page.
- Never compare `org.user_id` to the logged-in user on the client (teams later).
- Biome: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after writing code.
- Run from the worktree root. If `node_modules` is missing or stale, run `npm ci` first (see memory: worktree `@shared` resolution trap).
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File map

| File | Responsibility |
|---|---|
| `apps/web/lib/active-organization.ts` (new) | localStorage store for the active org id + `useActiveOrganizationId` hook |
| `apps/web/lib/organizations.ts` | `selectActiveOrganization(orgs, preferredId)`, `useActiveOrganization` reads the store, new `useOrganizations()` list hook |
| `apps/web/lib/auth.ts` | `clearToken()` also clears the active org id |
| `apps/web/app/[locale]/(authenticated)/(product)/OrganizationSwitcher.tsx` (new) | the sidebar switcher |
| `apps/web/app/[locale]/(authenticated)/(product)/ProductShell.tsx` | mounts the switcher under the logo |
| `apps/web/app/[locale]/(authenticated)/onboarding/page.tsx` | add-website mode, finalize sets active org + drops the cached org list |
| `apps/web/app/[locale]/dashboard/gsc/callback/page.tsx` | makes the connected org active before redirecting |
| `apps/web/messages/{en,tr}.json` | `ProductShell.switcher.*`, `Onboarding.actions.backToDashboard` |
| `apps/web/tests/active-organization.test.ts` (new) | store + selection tests |
| `PROGRESS.md`, `design/documentation-ia.md` | bookkeeping |

---

### Task 1: Active-org store and selection rule

**Files:**
- Create: `apps/web/lib/active-organization.ts`
- Modify: `apps/web/lib/organizations.ts:44-52` (`selectActiveOrganization`), `:69-71` (`getActiveOrganization`), `:81-88` (`useActiveOrganization` query)
- Modify: `apps/web/lib/auth.ts:17-19` (`clearToken`)
- Test: `apps/web/tests/active-organization.test.ts`

**Interfaces:**
- Produces (`apps/web/lib/active-organization.ts`):
  - `getActiveOrganizationId(): string | null`
  - `setActiveOrganizationId(id: string): void`
  - `clearActiveOrganizationId(): void`
  - `subscribeActiveOrganizationId(listener: () => void): () => void`
  - `useActiveOrganizationId(): string | null`
- Produces (`apps/web/lib/organizations.ts`):
  - `selectActiveOrganization(organizations: ProductOrganization[], preferredId: string | null): ProductOrganization | null`
  - `useOrganizations(): ProductOrganization[]` (used by Task 2)
  - `useActiveOrganization()` and `getActiveOrganization()` keep their signatures.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/tests/active-organization.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  clearActiveOrganizationId,
  getActiveOrganizationId,
  setActiveOrganizationId,
  subscribeActiveOrganizationId,
} from '../lib/active-organization';
import { type ProductOrganization, selectActiveOrganization } from '../lib/organizations';

function org(overrides: Partial<ProductOrganization> = {}): ProductOrganization {
  return {
    billing_tier: 'free',
    capabilities: { keyword_research: false, keyword_scheduling: false },
    id: 'org-1',
    name: 'Org 1',
    setup_status: 'setup_complete',
    website_url: 'https://one.example',
    ...overrides,
  };
}

describe('selectActiveOrganization', () => {
  const complete1 = org({ id: 'c1' });
  const complete2 = org({ id: 'c2' });
  const scanning = org({ id: 's1', setup_status: 'setup_scan_in_progress' });

  test('returns the preferred org when it is complete', () => {
    expect(selectActiveOrganization([complete1, complete2], 'c2')).toBe(complete2);
  });

  test('falls back to the first complete org when the preferred id is unknown', () => {
    expect(selectActiveOrganization([scanning, complete1, complete2], 'gone')).toBe(complete1);
  });

  test('ignores a preferred org that is not complete', () => {
    expect(selectActiveOrganization([scanning, complete1], 's1')).toBe(complete1);
  });

  test('falls back to the first org when none is complete', () => {
    expect(selectActiveOrganization([scanning], null)).toBe(scanning);
  });

  test('returns null for an empty list', () => {
    expect(selectActiveOrganization([], 'c1')).toBeNull();
  });
});

describe('active organization store', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    storage.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('round-trips set, get and clear through localStorage', () => {
    expect(getActiveOrganizationId()).toBeNull();
    setActiveOrganizationId('c2');
    expect(getActiveOrganizationId()).toBe('c2');
    expect(storage.get('seo_active_org')).toBe('c2');
    clearActiveOrganizationId();
    expect(getActiveOrganizationId()).toBeNull();
  });

  test('notifies subscribers on set and clear, and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeActiveOrganizationId(listener);
    setActiveOrganizationId('c1');
    clearActiveOrganizationId();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setActiveOrganizationId('c2');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('reads null when there is no window', () => {
    vi.unstubAllGlobals();
    expect(getActiveOrganizationId()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/web/tests/active-organization.test.ts`
Expected: FAIL — cannot resolve `../lib/active-organization`.

- [ ] **Step 3: Create the store**

Create `apps/web/lib/active-organization.ts`:

```ts
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'seo_active_org';

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Which org the product shell shows. A plain localStorage value next to the
 * JWT: one login can own several orgs, and this is the one the user picked in
 * the switcher. Readers go through `selectActiveOrganization`, which falls
 * back when the stored id no longer names a complete org, so a stale value
 * is harmless and never needs cleaning up.
 */
export function getActiveOrganizationId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setActiveOrganizationId(id: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, id);
  emit();
}

export function clearActiveOrganizationId(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  emit();
}

export function subscribeActiveOrganizationId(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getServerSnapshot(): string | null {
  return null;
}

/** Re-renders when the switcher changes the stored id. No provider needed. */
export function useActiveOrganizationId(): string | null {
  return useSyncExternalStore(
    subscribeActiveOrganizationId,
    getActiveOrganizationId,
    getServerSnapshot,
  );
}
```

- [ ] **Step 4: Teach the selection rule about the preferred id**

In `apps/web/lib/organizations.ts` replace `selectActiveOrganization` (lines 44-52) with:

```ts
export function selectActiveOrganization(
  organizations: ProductOrganization[],
  preferredId: string | null,
): ProductOrganization | null {
  const preferred = organizations.find(
    (organization) =>
      organization.id === preferredId && organization.setup_status === 'setup_complete',
  );

  return (
    preferred ??
    organizations.find((organization) => organization.setup_status === 'setup_complete') ??
    organizations[0] ??
    null
  );
}
```

Replace `getActiveOrganization` (lines 69-71) with:

```ts
export async function getActiveOrganization(): Promise<ProductOrganization | null> {
  return selectActiveOrganization(await getOrganizations(), getActiveOrganizationId());
}
```

Add the import at the top, after the `./api` import:

```ts
import { getActiveOrganizationId, useActiveOrganizationId } from './active-organization';
```

Change the `react` import to `import { useCallback, useEffect } from 'react';`.

In `useActiveOrganization`, replace the `useQuery` call (lines 84-89) with:

```ts
  const preferredId = useActiveOrganizationId();

  const query = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: getOrganizations,
    // A new `select` identity re-runs the selection on the cached list, so a
    // switch never refetches.
    select: useCallback(
      (organizations: ProductOrganization[]) =>
        selectActiveOrganization(organizations, preferredId),
      [preferredId],
    ),
    staleTime: 5 * 60 * 1000,
  });
```

Update the doc comment above `useActiveOrganization` so its last sentence reads: "Called by both `ProductShell` and the page; react-query dedupes the two observers into one request, which is why there is no context/provider — the active id lives in `active-organization.ts`."

Append the list hook at the end of the file:

```ts
/** The full org list, for the switcher. Same query key as above, so it shares the fetch. */
export function useOrganizations(): ProductOrganization[] {
  const query = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: getOrganizations,
    staleTime: 5 * 60 * 1000,
  });

  return query.data ?? [];
}
```

- [ ] **Step 5: Clear the stored id on logout**

`clearToken()` is what every logout and 401 path calls (16 call sites), so clearing here covers all of them. In `apps/web/lib/auth.ts`:

```ts
import { clearActiveOrganizationId } from './active-organization';
```

and

```ts
export function clearToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
  // The active org belongs to the session that picked it.
  clearActiveOrganizationId();
}
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run apps/web/tests/active-organization.test.ts`
Expected: PASS, 8 tests.

Run: `npm run check:web`
Expected: clean. (`billing/page.tsx:109` calls `getActiveOrganization()` with no args, which is unchanged.)

- [ ] **Step 7: Lint and commit**

```bash
npm run lint:fix
git add apps/web/lib/active-organization.ts apps/web/lib/organizations.ts apps/web/lib/auth.ts apps/web/tests/active-organization.test.ts
git commit -m "web: persist the active organization in localStorage

The org list already returns every org a user owns; the frontend just picked
the first complete one. selectActiveOrganization now honours a stored id when
that org is complete, read through a useSyncExternalStore-backed store.

Part of #127

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Sidebar switcher

**Files:**
- Create: `apps/web/app/[locale]/(authenticated)/(product)/OrganizationSwitcher.tsx`
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/ProductShell.tsx:107-115` (sidebar logo block)
- Modify: `apps/web/messages/en.json:1481` and `apps/web/messages/tr.json:1481` (`ProductShell` namespace)

**Interfaces:**
- Consumes: `useActiveOrganization`, `useOrganizations`, `ProductOrganization` from `@/lib/organizations`; `setActiveOrganizationId` from `@/lib/active-organization`; `Select`, `SelectContent`, `SelectItem`, `SelectSeparator`, `SelectTrigger` from `@/components/ui`.
- Produces: `OrganizationSwitcher(): JSX.Element | null` (default-less named export).

- [ ] **Step 1: Add the i18n keys**

In `apps/web/messages/en.json`, inside `"ProductShell"`, after the `"organizationFallback": "Your organization"` line (add a trailing comma to it):

```json
    "switcher": {
      "addWebsite": "Add website",
      "label": "Switch organization"
    }
```

In `apps/web/messages/tr.json`, same position after `"organizationFallback": "Organizasyonunuz"`:

```json
    "switcher": {
      "addWebsite": "Web sitesi ekle",
      "label": "Organizasyon değiştir"
    }
```

Run: `npx vitest run apps/web/tests/messages.test.ts`
Expected: PASS (parity holds, both strings differ from English).

- [ ] **Step 2: Write the component**

Create `apps/web/app/[locale]/(authenticated)/(product)/OrganizationSwitcher.tsx`:

```tsx
'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { setActiveOrganizationId } from '@/lib/active-organization';
import {
  type ProductOrganization,
  useActiveOrganization,
  useOrganizations,
} from '@/lib/organizations';

// Sentinel select value: an action row, not an org.
const ADD_WEBSITE = '__add__';

function hostOf(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).host;
  } catch {
    return websiteUrl;
  }
}

function labelOf(organization: ProductOrganization): string {
  return organization.name ?? hostOf(organization.website_url);
}

/**
 * Which of the user's orgs the product shell shows. Lists only completed orgs:
 * an abandoned scan is not somewhere the shell can land. Always rendered, even
 * with one org, so "Add website" is discoverable.
 */
export function OrganizationSwitcher() {
  const t = useTranslations('ProductShell.switcher');
  const router = useRouter();
  const { organization } = useActiveOrganization();
  const organizations = useOrganizations();

  if (!organization) return null;

  const completed = organizations.filter((entry) => entry.setup_status === 'setup_complete');

  function handleChange(value: string) {
    if (value === ADD_WEBSITE) {
      router.push('/onboarding?new=1');
      return;
    }
    if (!organization || value === organization.id) return;
    setActiveOrganizationId(value);
    // Always land on /home: detail pages carry an entity of the old org.
    router.replace('/home');
  }

  return (
    <Select value={organization.id} onValueChange={handleChange}>
      <SelectTrigger aria-label={t('label')} className="h-auto border-0 bg-transparent px-5 py-2 shadow-none">
        <span className="flex min-w-0 flex-col items-start text-left">
          <span className="w-full truncate font-medium text-sm">{labelOf(organization)}</span>
          <span className="w-full truncate text-muted-foreground text-xs">
            {hostOf(organization.website_url)}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {completed.map((entry) => (
          <SelectItem key={entry.id} value={entry.id}>
            {labelOf(entry)}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={ADD_WEBSITE}>
          <Plus className="size-4" aria-hidden="true" />
          {t('addWebsite')}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
```

- [ ] **Step 3: Mount it in the sidebar**

In `ProductShell.tsx`, add the import next to the other local imports:

```ts
import { OrganizationSwitcher } from './OrganizationSwitcher';
```

Then, in the sidebar, directly after the logo `<div className="flex h-16 items-center gap-3 px-5">…</div>` block (line 114) and before `<nav className="flex flex-col">`, insert:

```tsx
          <OrganizationSwitcher />
```

Leave the header's `/home` title (org name + url) as it is.

- [ ] **Step 4: Typecheck, lint, look at it**

Run: `npm run check:web && npm run lint`
Expected: clean.

Run the app (`npm run dev`, or the `run` skill), log in with an account that owns one org, open `/home`. Expected: the trigger under the logo shows the org name and host; opening it lists that org with a check mark, a separator, then "Add website". Choosing "Add website" navigates to `/onboarding?new=1` (which still redirects to `/home` until Task 3).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/(authenticated)/(product)/OrganizationSwitcher.tsx" "apps/web/app/[locale]/(authenticated)/(product)/ProductShell.tsx" apps/web/messages/en.json apps/web/messages/tr.json
git commit -m "web: organization switcher in the product sidebar

Part of #127

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: "Add website" mode in onboarding

**Files:**
- Modify: `apps/web/app/[locale]/(authenticated)/onboarding/page.tsx` — imports (`:3-14`), state (`:43`), `checkWorkspaceGate` (`:69-101`), `handleFinish` (`:346-357`), header JSX (`:528-534`)
- Modify: `apps/web/messages/en.json:1082-1089` and `apps/web/messages/tr.json:1082-1089` (`Onboarding.actions`)
- Test (existing, must stay green): `apps/web/tests/onboarding-query-provider.test.ts`

**Interfaces:**
- Consumes: `setActiveOrganizationId` (Task 1), `dashboardQueryKeys.organizations()` from `@/lib/dashboard-query-keys`, `useQueryClient` from `@tanstack/react-query`, `Link` from `@/i18n/navigation`.

- [ ] **Step 1: Add the i18n key**

In `apps/web/messages/en.json`, inside `"Onboarding" > "actions"`, after `"back": "Back",`:

```json
      "backToDashboard": "Back to dashboard",
```

In `apps/web/messages/tr.json`, same position after `"back": "Geri",`:

```json
      "backToDashboard": "Panele dön",
```

- [ ] **Step 2: Read the mode and skip the redirect**

In `onboarding/page.tsx`:

Imports — change `useRouter` line and add the others:

```ts
import { useQueryClient } from '@tanstack/react-query';
import { Link, useRouter } from '@/i18n/navigation';
import { setActiveOrganizationId } from '@/lib/active-organization';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
```

State — after `const [orgId, setOrgId] = useState<string | null>(null);` add:

```ts
  const queryClient = useQueryClient();
  // `?new=1` is the switcher's "Add website": the user already has a complete
  // org and must not be bounced to /home. Read once, the way settings reads
  // `?tab=` — useSearchParams would force a Suspense boundary on this page.
  const [isAddingWebsite] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('new') === '1',
  );
```

In `checkWorkspaceGate`, change

```ts
      if (status.setupComplete) {
        router.replace('/home', { locale });
        return;
      }
```

to

```ts
      if (status.setupComplete && !isAddingWebsite) {
        router.replace('/home', { locale });
        return;
      }
```

and add `isAddingWebsite` to that `useCallback`'s dependency array: `[isAddingWebsite, locale, router]`.

- [ ] **Step 3: Make the new org active on finalize**

In `handleFinish`, the success path currently reads:

```ts
      setWorkspaceStatusCache(workspaceStatus.ok ? workspaceStatus.setupComplete : true);
      router.replace('/home', { locale });
```

Change it to:

```ts
      setWorkspaceStatusCache(workspaceStatus.ok ? workspaceStatus.setupComplete : true);
      // The shell must mount on the org we just finished. The cached org list
      // (5 min staleTime) predates it, so drop it rather than let the selector
      // fall back to the previous org.
      setActiveOrganizationId(orgId);
      queryClient.removeQueries({ queryKey: dashboardQueryKeys.organizations() });
      router.replace('/home', { locale });
```

This runs for a first org too (harmless: one code path).

- [ ] **Step 4: Add the back link**

In the ready-state JSX, change the header block

```tsx
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-primary text-sm">{t('eyebrow')}</p>
            <h1 className="mt-1 font-bold text-3xl text-foreground">{t('title')}</h1>
          </div>
          <LocaleSwitcher />
        </div>
```

to

```tsx
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            {isAddingWebsite ? (
              <Link
                href="/home"
                className="mb-2 inline-block text-muted-foreground text-sm hover:text-foreground"
              >
                ← {t('actions.backToDashboard')}
              </Link>
            ) : null}
            <p className="font-semibold text-primary text-sm">{t('eyebrow')}</p>
            <h1 className="mt-1 font-bold text-3xl text-foreground">{t('title')}</h1>
          </div>
          <LocaleSwitcher />
        </div>
```

- [ ] **Step 5: Run the existing test, typecheck, lint**

Run: `npx vitest run apps/web/tests/onboarding-query-provider.test.ts apps/web/tests/messages.test.ts`
Expected: PASS. (The provider test renders the page server-side; `window` is undefined there, so `isAddingWebsite` is `false` and `Link` is mocked.)

Run: `npm run check:web && npm run lint`
Expected: clean.

- [ ] **Step 6: Manual round trip**

With the app running and an account that owns one complete org: switcher → "Add website" → wizard shows the back link and does not redirect → enter a second URL → scan → finish. Expected: `/home` shows the new org in the header and switcher; the switcher lists both; switching back works; reloading keeps the choice; logging out and in lands on the first complete org.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/[locale]/(authenticated)/onboarding/page.tsx" apps/web/messages/en.json apps/web/messages/tr.json
git commit -m "web: add-website mode for onboarding

/onboarding?new=1 skips the redirect-to-home for users who already have a
complete org, and finalize makes the new org the active one.

Part of #127

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: GSC return, bookkeeping, full verification

**Files:**
- Modify: `apps/web/app/[locale]/dashboard/gsc/callback/page.tsx:65` (after `setOrgId(body.org_id)`)
- Modify: `PROGRESS.md:36`, `PROGRESS.md:62`
- Modify: `design/documentation-ia.md:53`

**Interfaces:**
- Consumes: `setActiveOrganizationId` (Task 1).

- [ ] **Step 1: Make the connected org active on the GSC return**

In `gsc/callback/page.tsx` add the import:

```ts
import { setActiveOrganizationId } from '@/lib/active-organization';
```

and directly after `setOrgId(body.org_id);` (line 65):

```ts
      // Settings opens on the org that started the connect, even if another
      // tab switched orgs during the OAuth round trip.
      setActiveOrganizationId(body.org_id);
```

The GitHub callback gets no such line: its exchange response carries no `org_id` (the id lives only in the signed state), and the stored value survives the round trip unchanged in the common case.

- [ ] **Step 2: PROGRESS.md**

Replace line 36 (`- ⬜ Multi-organization switching — …`) with:

```markdown
- ✅ Multi-organization switching — sidebar switcher over `GET /core/organizations`, active org persisted client-side, "Add website" re-enters onboarding; billing stays per org — [#127](https://github.com/seopotion/seo/issues/127)
```

On line 62, delete the trailing clause `; no multi-org switcher — [#127](https://github.com/seopotion/seo/issues/127)` so the sentence ends at `[#121](https://github.com/seopotion/seo/issues/121)`.

- [ ] **Step 3: documentation-ia.md**

On line 53, remove `; multi-org switching` from the "Hold — do NOT document as available" list, and append a new sentence to that bullet: `Multi-org switching shipped (#127, \`docs/superpowers/specs/2026-09-05-org-switcher-design.md\`) — its docs page is a follow-up.` Leave line 288 (`multi-org/teams — roadmap page only`) as is; teams are still roadmap.

- [ ] **Step 4: Full verification**

Run, from the worktree root:

```bash
npm run lint && npm run check:all && npm test
```

Expected: lint clean, all three typechecks clean, tests green except the one known local failure `wordpress-plugin-behavior.test.ts` (`spawnSync php ENOENT`, passes in CI).

Confirm the lockfile is untouched: `git status --short package-lock.json` prints nothing (see memory: macOS npm prunes `@emnapi`).

- [ ] **Step 5: Commit and open the PR**

```bash
git add "apps/web/app/[locale]/dashboard/gsc/callback/page.tsx" PROGRESS.md design/documentation-ia.md
git commit -m "web: GSC return keeps the connected org active; progress notes for #127

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin claude/multiple-orgs-per-account-2cf3b4
```

Open the PR into `dev` with title `[frontend] Organization switcher + add-website onboarding` and this body:

```markdown
One login can own several orgs. A sidebar switcher picks the active one, the choice persists in localStorage, and "Add website" re-enters onboarding without being bounced to /home. Billing stays per org. No backend change: every route already takes `org_id` and `GET /core/organizations` already returned the full list.

Spec: `docs/superpowers/specs/2026-09-05-org-switcher-design.md`. Teams/membership is a follow-up.

Manual check on a two-org account: switch both ways, reload keeps the choice, logout → login lands on the first complete org, add-website round trip makes the new org active.

Closes #127

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Then file the teams follow-up issue: title `[backend] Org membership: teammates, invites, roles`, label `backend`, body pointing at the spec's "Teams later" section: `loadOwnedOrg` becomes a membership check, `GET /core/organizations` returns member orgs, the switcher gates "Add website" by role.
