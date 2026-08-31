# Billing as a Top-Level Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/billing` a top-level sidebar destination that handles subscribing, upgrading, and managing a subscription, and delete the Settings billing tab.

**Architecture:** The `/billing` route already exists under `(product)` but has no nav entry; the Settings billing tab holds the Lemon Squeezy portal button. This plan adds a display-only `billing_tier` to the `/core/organizations` response so the page can tell `paid` from `expert`, drives tier-card state from a pure `tierState` helper, moves the portal control into `billing/_components/ManageSubscriptionCard.tsx`, and removes the Settings tab.

**Tech Stack:** Hono + `@hono/zod-openapi` (api), Next 16 App Router + React 19 + next-intl + TanStack Query + Tailwind v4 (web), Vitest, Biome.

**Spec:** `docs/superpowers/specs/2026-08-31-billing-tab-design.md`

## Global Constraints

- **Branch/PR:** work on the current branch `claude/billing-tab-reorganization-7303e5`; PR targets `dev`, never commit directly to `dev` or `master`.
- **Style:** match surrounding code. The authenticated app uses hardcoded `slate-*` / `emerald-*` / `red-*` Tailwind classes, **not** the semantic design tokens. Do not convert colors to tokens in this PR — that is [#273](https://github.com/seopotion/seo/issues/273).
- **Imports:** `verbatimModuleSyntax` is on — type-only imports must use `import type`.
- **Message bundles:** every key added to `apps/web/messages/en.json` needs a matching key in `tr.json` whose value is **actually translated** (a verbatim English copy fails `tests/messages.test.ts`). Every key removed from `en.json` must be removed from `tr.json` too.
- **User-facing tier names:** `paid` is displayed as **"Growth"**, `expert` as **"Business"** (`BillingPage.tiers.*.name`). Never show the raw plan ids in UI copy.
- **`billing_tier` is display-only.** Feature gating continues to read `capabilities.keyword_research` / `capabilities.keyword_scheduling`. Never branch entitlement on `billing_tier`.
- **Verification gate:** `npm run lint`, `npm run check:all`, and `npm test` must all pass before the work is called done. `apps/web/tests/wordpress-plugin-behavior.test.ts` fails locally with `spawnSync php ENOENT` — that one failure is expected locally and passes in CI. No other failure is acceptable.
- **Lockfile:** do not run `npm install`. If `package-lock.json` shows up modified, restore it (`git checkout -- package-lock.json`) — macOS npm strips Linux `@emnapi` optional deps and breaks CI `npm ci`.

---

### Task 1: Expose `billing_tier` on the organizations response

**Files:**
- Modify: `apps/api/src/schemas/core.ts:16-29` (the `Organization` object)
- Modify: `apps/api/src/routes/core.ts:60-71` (the `organizations.map` body)
- Modify: `packages/shared/schemas/src/index.ts:1` (re-export `EntitlementPlan`)
- Test: `apps/api/tests/core.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GET /api/v0/core/organizations` returns each organization with `billing_tier: 'free' | 'paid' | 'expert'`. `EntitlementPlan` becomes importable from `@shared/schemas` (Task 2 and Task 3 both rely on this).

- [ ] **Step 1: Fix the legacy fixture in the existing test**

`apps/api/tests/core.test.ts` — the default `OrgRepo.findByUserId` mock returns an object that is not a valid `Org` (no `plan`, no `strategy_status`). Real orgs always have both, because `OrgRepo` parses through `OrgSchema` and both fields carry `.default(...)`. The mock below it (`org_paid`) already includes both. Make the default fixture valid so `billing_tier` has something to map.

In the `vi.mock('@shared/db', …)` block, add the two fields to the `org_1` object:

```ts
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
```

Also update the comment on the capabilities assertion in `GET /organizations returns the user orgs with a valid token` — it currently says "Free/legacy org (no plan)":

```ts
    // Free org: capabilities are computed server-side as false.
```

- [ ] **Step 2: Write the failing tests**

In `apps/api/tests/core.test.ts`, add a `billing_tier` assertion to the existing free-org test, immediately after the `capabilities` assertion inside `GET /organizations returns the user orgs with a valid token`:

```ts
    expect(json.organizations[0]?.billing_tier).toBe('free');
```

Add the same to the existing paid test, after its `capabilities` assertion inside `GET /organizations reports capabilities true for a paid org`:

```ts
    expect(json.organizations[0]?.billing_tier).toBe('paid');
```

Then add a new test after it, so `expert` is covered too:

```ts
  test('GET /organizations reports billing_tier for an expert org', async () => {
    const { OrgRepo } = await import('@shared/db');
    vi.mocked(OrgRepo.findByUserId).mockResolvedValueOnce([
      {
        id: 'org_expert',
        user_id: 'user_1',
        website_url: 'https://example.com',
        setup_status: 'setup_complete',
        plan: 'expert',
        strategy_status: 'none',
        created_at: new Date(),
      },
    ]);
    const token = await login();
    const res = await client.api.v0.core.organizations.$get(undefined, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.organizations[0]?.billing_tier).toBe('expert');
    // Entitlement still comes from capabilities, never from billing_tier.
    expect(json.organizations[0]?.capabilities).toEqual({
      keyword_research: true,
      keyword_scheduling: true,
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm test -- core
```

Expected: FAIL. The `billing_tier` assertions report `undefined`, and TypeScript flags `billing_tier` as not existing on the response type.

- [ ] **Step 4: Add the field to the response schema**

`apps/api/src/schemas/core.ts` — change the import on line 2 and add the field to `Organization`:

```ts
import { ENTITLEMENT_PLANS, SETUP_STATUSES } from '@shared/types';
```

```ts
const Organization = z
  .object({
    id: z.string(),
    website_url: z.string(),
    setup_status: z.enum(SETUP_STATUSES),
    name: z.string().optional(),
    // Server-computed entitlement capabilities (#99) — the frontend must not
    // derive these from `plan` (#13 may move entitlement to Stripe state).
    capabilities: z.object({
      keyword_research: z.boolean(),
      keyword_scheduling: z.boolean(),
    }),
    // Display-only: lets the billing page label the current plan and offer
    // higher tiers. Gate features on `capabilities`, never on this.
    billing_tier: z.enum(ENTITLEMENT_PLANS),
  })
  .openapi('Organization');
```

- [ ] **Step 5: Populate it in the route**

`apps/api/src/routes/core.ts` — inside the `orgs.map(...)`, add `billing_tier` after the `capabilities` block:

```ts
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
        })),
```

- [ ] **Step 6: Re-export `EntitlementPlan` from `@shared/schemas`**

`apps/web` depends on `@shared/schemas` but **not** on `@shared/types`, and `EntitlementPlan` is not currently re-exported. Tasks 2 and 3 need the type. Extend the existing re-export line at the top of `packages/shared/schemas/src/index.ts`:

```ts
export type { EntitlementPlan, SetupStatus, StrategyStatus } from '@shared/types';
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm test -- core
```

Expected: PASS, all tests in `apps/api/tests/core.test.ts`.

- [ ] **Step 8: Typecheck**

```bash
npm run check:all
```

Expected: clean. `apps/web` compiles the API route types via the typed client, so this confirms the schema change did not break the frontend build.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/schemas/core.ts apps/api/src/routes/core.ts apps/api/tests/core.test.ts packages/shared/schemas/src/index.ts
git commit -m "feat(api): expose display-only billing_tier on the org response

Part of the billing-tab reorganization: the web app can only see
capabilities today, so it cannot tell paid from expert. Adds a
display-only tier field and re-exports EntitlementPlan for apps/web."
```

---

### Task 2: `tierState` pure helper

**Files:**
- Create: `apps/web/app/[locale]/(authenticated)/(product)/billing/tiers.ts`
- Test: `apps/web/tests/billing-tiers.test.ts`

**Interfaces:**
- Consumes: `EntitlementPlan` from `@shared/schemas` (Task 1, Step 6), `planRank` from `@shared/schemas` (already exported via `export * from './org'`).
- Produces:
  - `export const TIERS = ['paid', 'expert'] as const`
  - `export type Tier = (typeof TIERS)[number]`
  - `export type TierState = 'current' | 'owned' | 'upgrade'`
  - `export function tierState(current: EntitlementPlan, tier: Tier): TierState`
  - `export function hasPurchasableTier(current: EntitlementPlan): boolean`

  Task 4 imports all of these. `TIERS` and `Tier` move here from `billing/page.tsx`, where they are currently declared locally.

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/billing-tiers.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  hasPurchasableTier,
  TIERS,
  tierState,
} from '../app/[locale]/(authenticated)/(product)/billing/tiers';

describe('tierState', () => {
  test('offers both tiers to a free org', () => {
    expect(tierState('free', 'paid')).toBe('upgrade');
    expect(tierState('free', 'expert')).toBe('upgrade');
  });

  test('marks the subscribed tier current and keeps the higher tier purchasable', () => {
    expect(tierState('paid', 'paid')).toBe('current');
    expect(tierState('paid', 'expert')).toBe('upgrade');
  });

  test('marks a lower tier owned once the org is on the top tier', () => {
    expect(tierState('expert', 'expert')).toBe('current');
    expect(tierState('expert', 'paid')).toBe('owned');
  });

  test('never reports upgrade for a tier the backend would reject', () => {
    // apps/api/src/routes/billing.ts returns 409 at equal-or-higher plan rank.
    expect(TIERS.filter((tier) => tierState('expert', tier) === 'upgrade')).toEqual([]);
    expect(TIERS.filter((tier) => tierState('paid', tier) === 'upgrade')).toEqual(['expert']);
  });
});

describe('hasPurchasableTier', () => {
  test('is true while something is still buyable', () => {
    expect(hasPurchasableTier('free')).toBe(true);
    expect(hasPurchasableTier('paid')).toBe(true);
  });

  test('is false on the top tier', () => {
    expect(hasPurchasableTier('expert')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test -- billing-tiers
```

Expected: FAIL — cannot resolve the `billing/tiers` module.

- [ ] **Step 3: Write the implementation**

Create `apps/web/app/[locale]/(authenticated)/(product)/billing/tiers.ts`:

```ts
import { type EntitlementPlan, planRank } from '@shared/schemas';

/** The tiers a user can buy. `free` is the absence of a purchase, not a tier. */
export const TIERS = ['paid', 'expert'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * How a tier card renders against the org's current plan:
 * - `current` — the plan the org is on
 * - `owned`   — a lower tier, already covered by the current plan
 * - `upgrade` — still purchasable
 *
 * Mirrors the server's guard in `apps/api/src/routes/billing.ts`, which returns
 * 409 for a checkout at equal-or-higher rank, so only `upgrade` cards get a CTA.
 */
export type TierState = 'current' | 'owned' | 'upgrade';

export function tierState(current: EntitlementPlan, tier: Tier): TierState {
  if (current === tier) return 'current';
  return planRank(current) > planRank(tier) ? 'owned' : 'upgrade';
}

/** Whether any tier is still buyable — gates the promo form, which only applies at checkout. */
export function hasPurchasableTier(current: EntitlementPlan): boolean {
  return TIERS.some((tier) => tierState(current, tier) === 'upgrade');
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test -- billing-tiers
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/(authenticated)/(product)/billing/tiers.ts" apps/web/tests/billing-tiers.test.ts
git commit -m "feat(web): add tierState helper for billing tier cards"
```

---

### Task 3: Sidebar nav entry and `billing_tier` on `ProductOrganization`

**Files:**
- Modify: `apps/web/lib/organizations.ts:12-21` (the `ProductOrganization` type)
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/ProductShell.tsx:4-16` (icon import) and `:26-64` (`navItems`)
- Modify: `apps/web/messages/en.json` (`ProductShell.nav`)
- Modify: `apps/web/messages/tr.json` (`ProductShell.nav`)

**Interfaces:**
- Consumes: `billing_tier` from the API (Task 1).
- Produces: `ProductOrganization.billing_tier: EntitlementPlan` — Task 4 reads `organization.billing_tier` to drive the page. `/billing` appears in the sidebar between Analytics and Settings.

- [ ] **Step 1: Add `billing_tier` to `ProductOrganization`**

`apps/web/lib/organizations.ts` — extend the type import on line 3 and the type on lines 12-21:

```ts
import type { EntitlementPlan, SetupStatus } from '@shared/schemas';
```

```ts
export type ProductOrganization = {
  // Display-only (see apps/api/src/schemas/core.ts) — gate features on
  // `capabilities`, never on this.
  billing_tier: EntitlementPlan;
  capabilities: {
    keyword_research: boolean;
    keyword_scheduling: boolean;
  };
  id: string;
  name?: string;
  setup_status: SetupStatus;
  website_url: string;
};
```

- [ ] **Step 2: Add the nav item**

`apps/web/app/[locale]/(authenticated)/(product)/ProductShell.tsx` — add `CreditCard` to the `lucide-react` import, keeping the list alphabetical as it is today:

```ts
import {
  Archive,
  BarChart3,
  CreditCard,
  FileSliders,
  Home,
  LayoutList,
  // Link2,
  LogOut,
  // Megaphone,
  Settings,
  Sparkles,
} from 'lucide-react';
```

Then insert the entry into `navItems` between `analytics` and `settings`:

```ts
  {
    href: '/analytics',
    key: 'analytics',
    icon: BarChart3,
  },
  {
    href: '/billing',
    key: 'billing',
    icon: CreditCard,
  },
  {
    href: '/settings',
    key: 'settings',
    icon: Settings,
  },
] as const;
```

No other change is needed here: `activeItem`, the topbar title/description, and the active-link highlight all derive from `navItems` generically.

- [ ] **Step 3: Add the nav copy**

`apps/web/messages/en.json` — inside `ProductShell.nav`, add (keys in this file are alphabetical, so it goes after `articleSettings` and before `contentPlanner`):

```json
      "billing": {
        "description": "Review your plan, upgrade, and manage payment details.",
        "label": "Billing"
      },
```

`apps/web/messages/tr.json` — the matching entry in `ProductShell.nav`:

```json
      "billing": {
        "description": "Planınızı inceleyin, yükseltin ve ödeme bilgilerinizi yönetin.",
        "label": "Faturalandırma"
      },
```

- [ ] **Step 4: Run the message-parity and typecheck gates**

```bash
npm test -- messages
```

Expected: PASS — the new keys exist in both locales, are non-empty, and the Turkish values differ from English.

```bash
npm run check:web
```

Expected: clean. `global.d.ts` types `t()` against `en.json`, so `t('nav.billing.label')` only compiles because Step 3 added the key.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/organizations.ts "apps/web/app/[locale]/(authenticated)/(product)/ProductShell.tsx" apps/web/messages/en.json apps/web/messages/tr.json
git commit -m "feat(web): add Billing to the product sidebar"
```

---

### Task 4: Unify the `/billing` page and retire the Settings tab

**Files:**
- Create: `apps/web/app/[locale]/(authenticated)/(product)/billing/_components/ManageSubscriptionCard.tsx` (via `git mv` from `settings/_components/BillingPanel.tsx`)
- Delete: `apps/web/app/[locale]/(authenticated)/(product)/settings/_components/BillingPanel.tsx`
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/billing/page.tsx`
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/settings/page.tsx:35` (import), `:39-45` (`settingsTabs`), `:538-546` (billing tabpanel)
- Modify: `apps/web/messages/en.json`, `apps/web/messages/tr.json`

**Interfaces:**
- Consumes: `TIERS`, `Tier`, `tierState`, `hasPurchasableTier` from `./tiers` (Task 2); `organization.billing_tier` (Task 3).
- Produces: `ManageSubscriptionCard` with props `{ onUnauthorized: () => void; organization: ProductOrganization | null }`. Settings drops to four tabs.

The panel's removal and its consumer's removal are one atomic change — split across two commits, the tree would not typecheck in between, so they live in the same task.

- [ ] **Step 1: Move the panel file**

```bash
mkdir -p "apps/web/app/[locale]/(authenticated)/(product)/billing/_components"
git mv "apps/web/app/[locale]/(authenticated)/(product)/settings/_components/BillingPanel.tsx" "apps/web/app/[locale]/(authenticated)/(product)/billing/_components/ManageSubscriptionCard.tsx"
```

- [ ] **Step 2: Rewrite the moved file**

Replace the whole contents of `apps/web/app/[locale]/(authenticated)/(product)/billing/_components/ManageSubscriptionCard.tsx`. The free-state branch and the `Link` import go away — the page owns that case now — and the translation namespace moves to `BillingPage.manage`:

```tsx
'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import type { ProductOrganization } from '@/lib/organizations';
import { cn } from '@/lib/utils';

/** Portal entry point for an org that already has a subscription. The page
 * renders this only when `capabilities.keyword_research` is true. */
export function ManageSubscriptionCard({
  onUnauthorized,
  organization,
}: {
  onUnauthorized: () => void;
  organization: ProductOrganization | null;
}) {
  const t = useTranslations('BillingPage.manage');
  const [portalError, setPortalError] = useState(false);

  const portalMutation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error('organization_required');

      const response = await api.api.v0.billing.portal.$post({
        json: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('portal_failed');
      }

      const { url } = await response.json();
      window.location.assign(url);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'unauthorized') return;

      setPortalError(true);
    },
  });

  function openPortal() {
    setPortalError(false);
    portalMutation.mutate();
  }

  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
      {portalError ? <StatusPanel tone="error">{t('error')}</StatusPanel> : null}
      <p className="text-slate-600 text-sm">{t('description')}</p>
      <Button
        className="w-fit"
        disabled={!organization || portalMutation.isPending}
        onClick={openPortal}
        size="sm"
      >
        {portalMutation.isPending ? t('opening') : t('open')}
      </Button>
    </div>
  );
}

function StatusPanel({ children, tone }: { children: ReactNode; tone: 'error' }) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
      )}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 3: Move `TIERS` / `Tier` out of the page**

In `apps/web/app/[locale]/(authenticated)/(product)/billing/page.tsx`, delete these two local declarations (they now live in `./tiers`):

```ts
const TIERS = ['paid', 'expert'] as const;
type Tier = (typeof TIERS)[number];
```

and add the imports. `ManageSubscriptionCard` and `./tiers` go after the existing `@/lib/utils` import, matching Biome's organize-imports ordering:

```ts
import { cn } from '@/lib/utils';
import { ManageSubscriptionCard } from './_components/ManageSubscriptionCard';
import { hasPurchasableTier, type Tier, TIERS, tierState } from './tiers';
```

- [ ] **Step 4: Render the unified page body**

Still in `billing/page.tsx`, replace the returned JSX of `BillingPage` — everything from `return (` after the `organizationError` guards down to the closing `);` of the component — with the version below. The `<h1>`, the checkout-error panel, and the promo card keep their existing markup; what is new is `currentTier`, the `ManageSubscriptionCard`, the per-card state, and the promo gate.

```tsx
  const currentTier = organization?.billing_tier ?? 'free';
  const isSubscribed = Boolean(organization?.capabilities.keyword_research);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="font-semibold text-slate-950 text-xl">{t('title')}</h1>
        <p className="mt-1 text-slate-600 text-sm">{t('description')}</p>
      </div>

      {checkoutError ? (
        <StatusPanel tone="error">{t(`errors.${checkoutError}`)}</StatusPanel>
      ) : null}

      {isSubscribed ? (
        <ManageSubscriptionCard onUnauthorized={goToLogin} organization={organization} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {TIERS.map((tier) => {
          const state = tierState(currentTier, tier);

          return (
            <Card key={tier} className="border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {t(`tiers.${tier}.name`)}
                  {state === 'upgrade' ? null : (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700 text-xs">
                      {t(`tierState.${state}`)}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-slate-600 text-sm">{t(`tiers.${tier}.description`)}</p>
                {state === 'upgrade' ? (
                  <Button
                    disabled={!organization || checkoutMutation.isPending}
                    onClick={() => startCheckout(tier)}
                  >
                    {checkoutMutation.isPending && checkoutMutation.variables === tier
                      ? t('redirecting')
                      : t(`tiers.${tier}.cta`)}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {hasPurchasableTier(currentTier) ? (
        <Card className="border-slate-200 shadow-none">
          <CardContent className="grid gap-2 pt-6">
            <p className="font-medium text-slate-950 text-sm">{t('promo.title')}</p>
            {appliedPromo ? (
              <div className="flex items-center justify-between rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800 text-sm">
                <span>
                  {t('promo.applied', {
                    code: appliedPromo.code,
                    discount: discountLabel(appliedPromo),
                  })}
                </span>
                <Button
                  onClick={() => {
                    setAppliedPromo(null);
                    setPromoError(null);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {t('promo.remove')}
                </Button>
              </div>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (promoInput.trim() !== '') promoMutation.mutate(promoInput);
                }}
              >
                <input
                  className="w-48 rounded-md border border-slate-200 px-3 py-1.5 text-sm uppercase"
                  onChange={(event) => setPromoInput(event.target.value)}
                  placeholder={t('promo.placeholder')}
                  value={promoInput}
                />
                <Button
                  disabled={promoMutation.isPending || promoInput.trim() === ''}
                  type="submit"
                  variant="outline"
                >
                  {promoMutation.isPending ? t('promo.applying') : t('promo.apply')}
                </Button>
              </form>
            )}
            {promoError ? (
              <p className="text-red-600 text-sm">{t(`promo.errors.${promoError}`)}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
```

Declare `currentTier` and `isSubscribed` with the other derived values, above the early-return guards (the three `activationState` branches, then `organizationLoading`, `no_organization`, and the generic `organizationError`) — not inside the `return`. React hook rules are unaffected since neither is a hook.

Leave the activation poll, its redirect to `/home`, and all four early returns exactly as they are.

> **Superseded by post-review fixes.** Leaving the poll alone turned out to be
> wrong for a `paid` org buying `expert`: its success predicate
> (`capabilities.keyword_research`) is already true before that purchase, so the
> poll returned on its first iteration. The poll's interval, timeout, states and
> `/home` redirect are unchanged, but its predicate now compares the purchased
> tier (threaded through the checkout redirect) against `billing_tier`. The
> heading was likewise made state-dependent. See the spec's *Post-review
> amendments*.

- [ ] **Step 5: Drop the tab from Settings**

`apps/web/app/[locale]/(authenticated)/(product)/settings/page.tsx`:

Remove the import on line 35:

```ts
import { BillingPanel } from './_components/BillingPanel';
```

Remove `'billing'` from `settingsTabs`, leaving four:

```ts
const settingsTabs = [
  'business',
  'audienceCompetitors',
  'integrations',
  'googleSearchConsole',
] as const;
```

Remove the whole billing tabpanel block:

```tsx
      <div
        id="settings-panel-billing"
        role="tabpanel"
        aria-labelledby="settings-tab-billing"
        hidden={activeTab !== 'billing'}
      >
        <BillingPanel onUnauthorized={handleUnauthorized} organization={organization} />
      </div>
```

Leave `SAVEABLE_TABS`, the `?tab=` effect, and everything else untouched. A stale `?tab=billing` bookmark now matches no tab, and the existing `settingsTabs.find(...)` already falls through to the default `business` tab rather than erroring.

- [ ] **Step 6: Move the message keys**

`apps/web/messages/en.json` — add `manage` and `tierState` to the `BillingPage` namespace (alphabetical: `manage` after `errors`, `tierState` after `status`), copying the values from the `SettingsPage.billing` block being retired:

```json
    "manage": {
      "description": "You have an active paid subscription. Manage your payment method or cancel from the billing portal.",
      "error": "Could not open the billing portal. Try again.",
      "open": "Manage billing",
      "opening": "Opening..."
    },
```

```json
    "tierState": {
      "current": "Current plan",
      "owned": "Included in your plan"
    },
```

Then delete the whole `SettingsPage.billing` object from `en.json` — all six keys (`description`, `freeDescription`, `manage`, `manageError`, `opening`, `upgradeCta`). `freeDescription` and `upgradeCta` have no replacement; the page's own `title` / `description` cover that case now.

`apps/web/messages/tr.json` — the same two additions:

```json
    "manage": {
      "description": "Aktif bir ücretli aboneliğiniz var. Ödeme yönteminizi faturalandırma portalından yönetin veya iptal edin.",
      "error": "Faturalandırma portalı açılamadı. Tekrar deneyin.",
      "open": "Faturalandırmayı yönet",
      "opening": "Açılıyor..."
    },
```

```json
    "tierState": {
      "current": "Mevcut planınız",
      "owned": "Planınıza dahil"
    },
```

and delete the whole `SettingsPage.billing` object from `tr.json` too.

- [ ] **Step 7: Verify**

```bash
npm test -- messages
```

Expected: PASS. If `has no untranslated values outside the allowlist` fails, a Turkish value was left identical to English — fix the translation rather than allowlisting it.

```bash
npm test -- billing-tiers
```

Expected: PASS (unchanged from Task 2 — confirms the move of `TIERS` did not break the helper).

```bash
npm run check:web
```

Expected: clean. `SettingsPage.tabs.billing` is still in the bundles — it is now an unused key, which nothing fails on; Task 5 deletes it.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/app/[locale]/(authenticated)/(product)/billing" "apps/web/app/[locale]/(authenticated)/(product)/settings" apps/web/messages/en.json apps/web/messages/tr.json
git commit -m "feat(web): unify checkout and subscription management on /billing

Moves the portal control out of Settings and drives tier cards from
billing_tier, so a Growth org can reach Business in-app."
```

---

### Task 5: Repoint the billing deep links and finish verification

**Files:**
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/content-history/[articleId]/page.tsx:1144`
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/article-settings/page.tsx:279`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/tr.json`

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: no in-app reference to `/settings?tab=billing` or `SettingsPage.tabs.billing` remains.

- [ ] **Step 1: Repoint the two deep links**

`apps/web/app/[locale]/(authenticated)/(product)/content-history/[articleId]/page.tsx` — in the action map around line 1143:

```ts
    billing: {
      href: '/billing',
      key: 'publishing.actions.billing',
```

`apps/web/app/[locale]/(authenticated)/(product)/article-settings/page.tsx` — around line 279:

```tsx
              <SettingsLink href="/billing">
                {t('fields.autoPublish.links.billing')}
              </SettingsLink>
```

Both link labels stay as they are ("Review billing" / "Faturalandırmayı incele") — only the destination changes.

- [ ] **Step 2: Delete the tab label and fix the stale copy**

`apps/web/messages/en.json`:

Delete `"billing": "Billing",` from `SettingsPage.tabs`.

Update `BillingPage.errors.already_subscribed`, which still points at Settings:

```json
      "already_subscribed": "You're already subscribed to this plan. Use Manage billing to change your subscription.",
```

`apps/web/messages/tr.json`:

Delete `"billing": "Faturalandırma",` from `SettingsPage.tabs`.

Update the matching error string:

```json
      "already_subscribed": "Bu plana zaten abonesiniz. Aboneliğinizi değiştirmek için Faturalandırmayı yönet seçeneğini kullanın.",
```

- [ ] **Step 3: Confirm nothing still references the old locations**

```bash
grep -rn "tab=billing\|BillingPanel\|SettingsPage.billing\|tabs.billing" apps/web/app apps/web/components apps/web/lib apps/web/messages apps/web/tests
```

Expected: no output.

- [ ] **Step 4: Run the full gate**

```bash
npm run lint
```

Expected: clean. Run `npm run lint:fix` if Biome reports formatting or import-order diffs, then re-run.

```bash
npm run check:all
```

Expected: clean — this is the first point at which the whole chain typechecks.

```bash
npm test
```

Expected: PASS, except `apps/web/tests/wordpress-plugin-behavior.test.ts` failing with `spawnSync php ENOENT`. That single failure is expected locally and passes in CI. Any other failure must be fixed before continuing.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/[locale]/(authenticated)/(product)/content-history" "apps/web/app/[locale]/(authenticated)/(product)/article-settings/page.tsx" apps/web/messages/en.json apps/web/messages/tr.json
git commit -m "refactor(web): drop the Settings billing tab

Billing is a top-level tab now; repoints the two in-app deep links and
fixes the already_subscribed copy that still pointed at Settings."
```

- [ ] **Step 6: Manual smoke check**

Local infra and a dev stack are needed:

```bash
docker compose up -d
```

```bash
npm run dev
```

Flip the org's plan with the `seo-dev` CLI between checks, substituting your local org id for `<org-id>`:

```bash
npm run cli -- db set-plan --org <org-id> --plan free
```

Reload `/billing` after each flip — the org is cached by TanStack Query, so a hard reload is needed for the new `billing_tier` to land.

1. `--plan free` → both tier cards show CTAs, promo form visible, **no** manage card.
2. `--plan paid` → Growth shows "Current plan" with no button, Business keeps its CTA, manage card and promo form both present.
3. `--plan expert` → Business shows "Current plan", Growth shows "Included in your plan", neither has a CTA, promo form hidden, manage card present.
4. Settings shows four tabs and no billing tab.
5. `/settings?tab=billing` opens Settings on the Business tab without erroring.
6. Billing appears in the sidebar between Analytics and Settings, and the topbar reads "Billing" with its description.

---

## Wrap-up

- [ ] Update `PROGRESS.md` only if it names the Settings billing tab — check with `grep -n billing PROGRESS.md` and keep any edit to one terse line.
- [ ] Open the PR into `dev`. Body should link the spec, note that `billing_tier` is display-only and entitlement still flows through `capabilities`, and reference [#273](https://github.com/seopotion/seo/issues/273) as the deliberately-excluded design-token work. There is no issue for this change to close.
