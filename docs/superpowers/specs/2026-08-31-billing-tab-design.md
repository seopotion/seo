# Billing as a top-level tab

**Date:** 2026-08-31
**Status:** Approved, ready for implementation
**Issue:** none (ad-hoc UX cleanup)

## Problem

Billing is split across two places, and neither is discoverable.

| Where | What it does |
| --- | --- |
| `/billing` (`app/[locale]/(authenticated)/(product)/billing/page.tsx`, 397 lines) — **not in the sidebar** | Upgrade/checkout: `paid` + `expert` tier cards, promo-code form, post-checkout activation polling. Reachable only from CTAs elsewhere in the app. |
| `/settings?tab=billing` → `BillingPanel` (95 lines), the 5th Settings tab | Free org → button linking to `/billing`. Subscribed org → "Manage billing" button opening the Lemon Squeezy portal. |

Consequences:

- A paying customer's only route to the payment portal is Settings → 5th tab.
- The upgrade page has no navigation entry at all.
- A `paid` org has **no in-app path to `expert`**, even though the backend allows
  that purchase (`apps/api/src/routes/billing.ts:48` only returns 409 at
  equal-or-higher plan rank).

## Goal

One discoverable top-level Billing destination that serves both states —
subscribe, upgrade, and manage — and remove the Settings tab.

## Constraint discovered during design

`GET /core/organizations` returns only `capabilities.keyword_research` and
`capabilities.keyword_scheduling`, both computed as `isPaid(org)`
(`apps/api/src/routes/core.ts:66`). The web app therefore cannot distinguish
`paid` from `expert`, and `apps/api/src/schemas/core.ts:22` explicitly forbids
deriving entitlement from `plan` on the frontend (#99; #13 may move entitlement
to Stripe state).

Rendering an accurate "current plan" and offering `expert` as an upgrade needs
the tier. The design adds it as a **display-only** field, distinct from the
capability flags that gate features.

## Design

### 1. API — expose the billing tier (display-only)

`apps/api/src/schemas/core.ts` — add to the `Organization` object:

```ts
// Display-only: lets the billing page label the current plan and offer
// higher tiers. Feature gating still reads `capabilities` (#99) — never
// branch on this field for entitlement.
billing_tier: z.enum(ENTITLEMENT_PLANS),
```

`apps/api/src/routes/core.ts` — populate it with `billing_tier: o.plan` alongside
the existing `capabilities` block.

Named `billing_tier` rather than `plan` so it does not read as the entitlement
source of truth.

**Test** (`apps/api/tests/core.test.ts`): a `free` org and an `expert` org each
round-trip the correct `billing_tier`, and the `capabilities` flags are
unchanged.

### 2. Navigation — `/billing` becomes a sidebar item

- `apps/web/app/[locale]/(authenticated)/(product)/ProductShell.tsx`: insert
  `{ href: '/billing', key: 'billing', icon: CreditCard }` into `navItems`
  **above** the Settings entry (`… Analytics, Billing, Settings`).
- `apps/web/messages/en.json` + `tr.json`: add `ProductShell.nav.billing.label`
  and `ProductShell.nav.billing.description` (the topbar renders both).

No route move: `/billing` already lives under `(product)`, so it already gets
`ProductAccessGuard`, `ProductShell`, and the topbar.

### 3. The unified `/billing` page

**Tier-card state as a pure helper.** New
`app/[locale]/(authenticated)/(product)/billing/tiers.ts`:

```ts
tierState(current: EntitlementPlan, tier: Tier): 'current' | 'owned' | 'upgrade'
```

- `current === tier` → `'current'`
- `planRank(current) > planRank(tier)` → `'owned'`
- otherwise → `'upgrade'`

Resulting UI per tier:

| `billing_tier` | Paid card | Expert card |
| --- | --- | --- |
| `free` | upgrade CTA | upgrade CTA |
| `paid` | "Current plan", button disabled | upgrade CTA |
| `expert` | "Included", no button | "Current plan", button disabled |

The `paid` row is the substantive gain: paid→expert becomes reachable in-app
for the first time, and the backend already permits it.

**Manage-subscription control moves in.** Relocate
`settings/_components/BillingPanel.tsx` to
`billing/_components/ManageSubscriptionCard.tsx`:

- Drop its free-state branch — the page owns that case now.
- Keep the portal mutation, its `portalError` status panel, and the
  `onUnauthorized` prop.
- Render it above the tier cards whenever the org is subscribed
  (`capabilities.keyword_research`).

**Promo form** stays visible only while at least one tier is still purchasable
(i.e. `billing_tier !== 'expert'`), since it applies at checkout.

The page keeps its own `<h1>` and description — `analytics` and
`content-history` do the same, so this matches sibling pages.

`ProductOrganization` in `apps/web/lib/organizations.ts` gains
`billing_tier: EntitlementPlan` to match the API response.

### 4. Settings cleanup and link repointing

- `settings/page.tsx`: remove `'billing'` from `settingsTabs`, remove the
  `settings-panel-billing` tabpanel div, and remove the `BillingPanel` import.
  Settings goes from 5 tabs to 4.
- Messages (en + tr): remove `SettingsPage.tabs.billing`; move the
  `SettingsPage.billing.*` strings into the billing page's namespace.
- Repoint both `/settings?tab=billing` deep links to `/billing`:
  - `content-history/[articleId]/page.tsx:1144`
  - `article-settings/page.tsx:279`
- Fix `messages/en.json:116` — the `already_subscribed` copy still reads
  "Manage your billing from Settings instead." Point it at Billing. Update the
  `tr.json` counterpart.

## Testing

- `apps/web/tests/billing-tiers.test.ts` — new unit tests for `tierState`
  across all three `billing_tier` values, matching the repo's pure-function test
  idiom (`home-utils.test.ts`, `planner-utils.test.ts`).
- `apps/api/tests/core.test.ts` — extended for `billing_tier`.
- `apps/web/tests/messages.test.ts` already enforces en/tr key parity, so the
  string moves are covered by an existing test.
- Full gate before claiming done: `npm run lint`, `npm run check:all`,
  `npm test`. The typed-client chain means an API schema change that the web app
  does not follow fails `check:web`.

## Out of scope

- Converting the page's hardcoded `slate-*` classes to the design-token layer.
  The authenticated app bypasses its own tokens roughly 6:1; that is tracked in
  [#273](https://github.com/seopotion/seo/issues/273) and deliberately kept out
  of this PR.
- Any change to how entitlement itself is computed or stored.
- Surfacing renewal dates, invoices, or seat counts on the billing page.
- Redirecting the legacy `/settings?tab=billing` URL. The `tab` query param is
  read by `settings/page.tsx` and silently ignored when it matches no tab, so a
  stale bookmark lands on Settings' first tab rather than erroring. Both in-app
  links are repointed; no external links to that URL exist.
