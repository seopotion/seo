# Promo Codes — Design

**Date:** 2026-08-29
**Status:** Approved pending review
**Related:** `design/architecture.md` (promo codes as first-class billing concept), `design/admin-panel.md` (comped-plan wart), PROGRESS.md #13 (billing), #131 (FE tier display gap)

## 1. Goal

Promo codes for seopotion, covering three cases with one mechanism:

- **Internal / team:** 100% off forever (free forever for insiders' orgs).
- **External marketing:** e.g. 30% off for 3 months, or 100% off for 6 months.
- **Affiliates:** attribution only — each affiliate gets code(s); we record which code
  redeemed each subscription so affiliates can be paid manually. No affiliate-facing
  UI, no automated payouts.

## 2. Core decision: every code is a LemonSqueezy discount

There is **one kind of promo code**. Every code created in our admin is backed by a real
LemonSqueezy discount (created via the LS API, id stored locally). Redemption always
happens through the normal LS checkout; entitlement always flows through the existing
webhook → `applyBillingEvent` path.

Consequences (why this beats a separate "comp" path):

- `applyBillingEvent` remains the **sole** entitlement writer in the paid path. No
  second writer, no fourth copy of the strategy-kick sequence.
- Insiders get a real LS subscription at $0 → the existing "comped org has no
  Subscription row → portal 404" wart disappears for promo-comped orgs.
- LS discount fields map 1:1 to our cases: `amount_type: percent` +
  `duration: 'once' | 'repeating' | 'forever'` + `duration_in_months`:
  - 30% off 3 months → `{ amount: 30, duration: 'repeating', duration_in_months: 3 }`
  - 100% off 6 months → `{ amount: 100, duration: 'repeating', duration_in_months: 6 }`
  - free forever → `{ amount: 100, duration: 'forever' }`

Accepted trade-offs:

- Insiders go through LS checkout and may need to enter a card even at $0 (LS docs
  don't specify; **verify in LS test mode during implementation** — either way the
  friction is accepted).
- LS `repeating` durations count **months against billing cycles**: a "3 months" code
  applied at a yearly-billed checkout discounts the whole first yearly payment. We take
  the **simple stance**: no product/variant restriction; the admin UI documents this
  semantic next to the duration field so whoever mints a code prices it knowingly.
  (Today `createCheckout` uses a single variant per tier, so this is mostly
  forward-looking.)
- We depend on LS discount deletion for deactivation (LS has no discount-update
  endpoint): deactivating a code **deletes the LS discount** and sets `active: false`
  locally (redemption history is untouched). Deactivation is one-way in v1; a
  "reactivate" would recreate the LS discount and can be added later if needed.

## 3. Data model (`@shared/schemas`, `@shared/db`)

### `promo-code.ts` — `PromoCodeSchema`, collection `promo_codes`

| field                | type                                     | notes |
| -------------------- | ---------------------------------------- | ----- |
| `id`                 | string                                   | Mongo `_id` mapped by repo |
| `code`               | string, `^[A-Z0-9]{3,32}$`               | normalized uppercase; unique index; LS allows 3–256 uppercase letters+digits |
| `name`               | string                                   | human label ("Launch promo", "Jane — affiliate") |
| `percent`            | int 1–100                                | percent only in v1 (no fixed-amount codes) |
| `duration`           | `'once' \| 'repeating' \| 'forever'`     | mirrors LS |
| `duration_in_months` | int ≥1, required iff `duration='repeating'` | |
| `max_redemptions`    | int ≥1, optional                         | unset = unlimited; also mirrored onto the LS discount as backstop |
| `expires_at`         | Date, optional                           | code can't be applied after this; mirrored to LS `expires_at` |
| `active`             | boolean, default true                    | kill switch; deactivation deletes the LS discount |
| `affiliate`          | string, optional                         | free-text affiliate label for attribution reporting |
| `ls_discount_id`     | string                                   | the LS discount backing this code |
| `created_at`         | Date                                     | |

### `promo-redemption.ts` — `PromoRedemptionSchema`, collection `promo_redemptions`

| field          | type                          | notes |
| -------------- | ----------------------------- | ----- |
| `id`           | string                        | |
| `code_id`      | string                        | promo code id |
| `code`         | string                        | denormalized for reporting |
| `org_id`       | string                        | |
| `status`       | `'pending' \| 'confirmed'`    | pending = checkout created with the code; confirmed = subscription activated |
| `created_at`   | Date                          | |
| `confirmed_at` | Date, optional                | |

Indexes (`ensure-indexes.ts`): unique `promo_codes.code`; unique
`promo_redemptions.(code_id, org_id)`; `promo_redemptions.org_id`.

### Repos

- `PromoCodeRepo`: `create`, `findByCode`, `findById`, `list`, `deactivate(id)`,
  `countConfirmedRedemptions` lives on the redemption repo instead (see below).
- `PromoRedemptionRepo`: `upsertPending(codeId, code, orgId)` (re-checkout with the
  same code overwrites the pending row — an abandoned checkout must not burn the
  code for that org), `confirmPendingByOrg(orgId)` (marks all pending rows for the
  org confirmed; returns what it confirmed), `countConfirmed(codeId)`,
  `findByCodeAndOrg(codeId, orgId)`, `listByCode(codeId)`.

## 4. Provider layer (`@shared/providers` billing)

Extend `BillingProvider` (LS-only implementation today):

- `createCheckout` input gains optional `discountCode?: string`. When present, sent as
  `checkout_data.discount_code`. In **all** cases the hosted checkout's own discount
  field is disabled (`checkout_options: { discount: false }`) so codes can only enter
  through our validated flow.
- New `createDiscount(input): Promise<{ providerDiscountId: string }>` — POST
  `/v1/discounts` with name, code, `amount`/`amount_type: 'percent'`, `duration`,
  `duration_in_months`, `is_limited_redemptions`/`max_redemptions`, `expires_at`.
- New `deleteDiscount(providerDiscountId): Promise<void>` — DELETE `/v1/discounts/{id}`.

No new secrets or config: reuses the existing LS API key/store id.

## 5. User-facing API (`apps/api/src/routes/billing.ts`)

### `POST /billing/promo/validate` (Bearer)

Body `{ org_id, code }` → validates ownership of the org, then the code:

- Reject reasons (422 with `{ valid: false, reason }`): `not_found`, `inactive`,
  `expired` (past `expires_at`), `exhausted` (confirmed count ≥ `max_redemptions`),
  `already_redeemed` (this org has a **confirmed** redemption of this code).
- Success: `{ valid: true, code, percent, duration, duration_in_months }` — the FE
  composes the human description ("30% off for 3 months") via i18n.

Code lookup is case-insensitive by normalizing input to uppercase.

### `POST /billing/checkout` — extended

`CheckoutBody` gains optional `promo_code`. When present the handler re-runs the same
validation (422 `{ error: 'invalid_promo', reason }` on failure), calls
`createCheckout` with `discountCode`, and `PromoRedemptionRepo.upsertPending(...)`
before returning the URL. Without a code, behavior is unchanged (checkout still sends
`checkout_options.discount: false`).

### Webhook confirmation

In `applyBillingEvent`, on `subscription_activated` for org X:
`PromoRedemptionRepo.confirmPendingByOrg(X)`. Fire-and-forget semantics — a failure
here must not fail entitlement (log and continue).

Known accuracy caveat (accepted): confirmation correlates by org, not by LS discount —
if a user applies a code but completes a checkout created without it, the redemption
still confirms. Rare and harmless at our scale; LS's own redemption records are the
audit fallback.

Enforcement is two-layer by design: our validation is the UX gate; the mirrored LS
`max_redemptions`/`expires_at` are the hard backstop against races (two orgs passing
validation simultaneously on the last redemption slot).

## 6. Admin surface

### Admin API (`apps/api/src/admin/routes/promo-codes.ts`, mounted with the other admin routes)

- `POST /admin/v0/promo-codes` — create. Body: `code` (optional — server generates a
  random 8-char code when omitted), `name`, `percent`, `duration`,
  `duration_in_months?`, `max_redemptions?`, `expires_at?`, `affiliate?`.
  Order of operations: create LS discount first, then insert the local doc; on insert
  failure, best-effort `deleteDiscount` and return 500. Duplicate local code → 409
  before touching LS. Audited (`promo_code.create`).
- `GET /admin/v0/promo-codes` — list all codes with `confirmed_redemptions` count.
- `GET /admin/v0/promo-codes/{id}/redemptions` — redemption rows (org id, status,
  dates) — this is the affiliate report.
- `POST /admin/v0/promo-codes/{id}/deactivate` — `deleteDiscount` at LS, set
  `active: false`. Audited (`promo_code.deactivate`).

`AdminActionSchema.action` enum gains the two new values.

### Admin SPA (`apps/admin`)

New "Promo codes" page: table (code, name, discount summary, affiliate, redemptions,
status) + create form + per-row deactivate with confirm. The create form's duration
field carries the yearly-billing-cycle explainer from §2. A row expands (or links) to
its redemption list.

## 7. Web app (`apps/web` billing page)

On `/billing`, below the tier cards: a "Have a promo code?" input + Apply button.

- Apply → `POST /billing/promo/validate`. Success: show the composed description
  ("PROMO30 — 30% off for 3 months") with a remove (×) affordance; failure: inline
  error message per reason.
- The applied code is passed as `promo_code` in the checkout mutation. Checkout 422
  `invalid_promo` (code died between apply and checkout) clears the applied state and
  shows the error.
- No client-side price math in v1 — the LS checkout shows the discounted price
  authoritatively. (Tier cards today show no prices anyway.)
- New i18n strings in `en.json` + `tr.json` under `BillingPage.promo.*`.

## 8. Testing

- **Schemas/repos:** unit tests for validation edges (regex, duration/months pairing);
  repo tests in the integration suite (upsertPending overwrite behavior, unique
  indexes, confirm flow).
- **Provider:** unit tests for `createDiscount`/`deleteDiscount`/`createCheckout`
  payloads with mocked `fetch` (matching existing lemonsqueezy tests' style).
- **API:** route tests via `testClient` with mocked repos/provider: each validate
  reject reason, checkout with valid/invalid/absent code, pending upsert called,
  webhook confirmation path, admin create ordering (LS-first) and deactivate.
- **Manual (LS test mode):** the one thing unit tests can't answer — whether a
  100%-forever checkout asks for a card — plus an end-to-end 30%-repeating checkout.

## 9. Out of scope (explicitly)

- Fixed-amount discounts, tier-restricted codes, per-user (vs per-org) limits.
- Affiliate accounts, dashboards, automated payouts, referral links / URL-param
  auto-apply (`?promo=`), onboarding-wizard entry point.
- Reactivating a deactivated code (recreate instead).
- Stripe: on a future provider swap, `createDiscount`/`deleteDiscount` map to Stripe
  coupons + promotion codes — the provider interface already isolates this.
