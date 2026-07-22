# Billing: LemonSqueezy-first, provider-abstracted — Design

_Date: 2026-07-22 · Issue: [#13](https://github.com/seopotion/seo/issues/13)_

## Goal

Add a real billing system so `free` orgs can pay to unlock gated features. Ship
**LemonSqueezy** as the first (and only-live) provider, behind a **provider
abstraction** so a future switch to **Stripe** is an additive adapter + config
change — with **zero changes** to entitlement gates, the subscription data
layer, or the event applier.

Non-goal: running two providers simultaneously. We want _swappable_, not
_concurrent_. The human-operator workflow behind the `expert` tier is out of
scope here — billing's only job is to grant the `expert` entitlement.

## Decisions (locked with product)

- **Two paid tiers:** `paid` and `expert`. `expert` = everything in `paid` plus a
  human operator assisting the team, plus a few extra features (gated later via
  `hasExpert`).
- **No trial.** `free` orgs can onboard and view the dashboard; gated features
  require payment. The unused `trial` enum member is dropped (pre-alpha, no
  backward-compat).
- **Separate `Subscription` collection** holds provider-specific billing state;
  `Org.plan` remains the provider-neutral entitlement source of truth.
- **Promo codes:** native LemonSqueezy discounts entered at LS checkout — we
  build nothing. (Stripe has its own coupon system; recreated there on a switch.)
- **Abstraction depth (Approach A):** thin provider adapter + a provider-neutral
  applier that is the sole writer of entitlement. One live provider at a time.

## Entitlement model

`@shared/types`:

```ts
export const ENTITLEMENT_PLANS = ['free', 'paid', 'expert'] as const;
```

`@shared/schemas/org.ts` — `Org.plan` stays the single entitlement source of
truth:

```ts
export function isPaid(org: Org): boolean {
  return org.plan === 'paid' || org.plan === 'expert';
}
export function hasExpert(org: Org): boolean {
  return org.plan === 'expert';
}
```

`isPaid` now treats `expert` as paid, so **every existing paid gate**
(`loadOwnedPaidOrg`) keeps working for expert automatically. `hasExpert` gates
expert-only surfaces added later.

## Data model

New `@shared/schemas/subscription.ts`:

```ts
Subscription {
  id: string;                       // _id -> string
  org_id: string;                   // indexed
  provider: 'lemonsqueezy';         // 'stripe' later — no schema change
  provider_customer_id: string;
  provider_subscription_id: string; // unique index (webhook correlation)
  tier: 'paid' | 'expert';
  status: 'active' | 'past_due' | 'cancelled' | 'expired';
  current_period_end: string;       // ISO
  created_at: string;
  updated_at: string;
}
```

New `SubscriptionRepo` (`@shared/db`):

- `findByProviderSubscriptionId(id)` — webhook correlation
- `findActiveByOrg(org_id)`
- `upsertFromEvent(...)` — idempotent, keyed on `provider_subscription_id`
- `ensureIndexes`: unique on `provider_subscription_id`, index on `org_id`

**Correlation:** at checkout we embed `org_id` in LemonSqueezy's
`checkout_data.custom` (Stripe equivalent: `client_reference_id`/`metadata`). The
`subscription_activated` event reads it back — the one time we learn
org↔subscription. All later events carry only `provider_subscription_id` and
resolve the org via `SubscriptionRepo`, so a forged later payload cannot move
another org's entitlement.

## Provider abstraction

`@shared/providers/billing/types.ts` — the neutral contract:

```ts
export interface BillingProvider {
  readonly name: 'lemonsqueezy';                          // 'stripe' later

  createCheckout(input: {
    tier: 'paid' | 'expert';
    orgId: string;
    userEmail: string;
  }): Promise<{ url: string }>;                            // embeds org_id

  verifyWebhook(rawBody: string, signature: string): boolean;  // over RAW body
  parseWebhookEvent(rawBody: string): BillingEvent | null;     // null = ignore
  getCustomerPortalUrl(providerCustomerId: string): Promise<{ url: string }>;
}
```

Internal event vocabulary — the applier only ever sees these:

```ts
export type BillingEvent =
  | { type: 'subscription_activated'; orgId; providerCustomerId; providerSubscriptionId; tier; currentPeriodEnd }
  | { type: 'subscription_updated';   providerSubscriptionId; tier; status; currentPeriodEnd }
  | { type: 'subscription_cancelled'; providerSubscriptionId }
  | { type: 'subscription_expired';   providerSubscriptionId };
```

`lemonsqueezy.ts` impl owns all LS-specifics: checkout API call, HMAC-SHA256
signature verification against the webhook secret, mapping LS event names
(`subscription_created/updated/cancelled/expired`) + `variant_id`→tier config
into `BillingEvent`s, and the portal URL. Unknown variant or event → `null`
(logged, ignored).

Tier↔variant config (env-driven, per-stage):

```
LEMONSQUEEZY_STORE_ID=<id>
LEMONSQUEEZY_VARIANT_PAID=<id>
LEMONSQUEEZY_VARIANT_EXPERT=<id>
```

## API routes

New `apps/api/src/routes/billing.ts`, mounted into `routes` (joins the typed
client), `OpenAPIHono<AuthEnv>`.

- **`POST /billing/checkout`** — auth'd. Body `{ tier }`. Owner-checks the org
  (reuses `loadOwnedPaidOrg`'s owner logic minus the paid gate). Already paid at
  same/lower tier → 409 (route to portal). Else `provider.createCheckout` →
  `{ url }`; frontend redirects.
- **`POST /billing/portal`** — auth'd. Loads active `Subscription` (none → 404);
  returns `provider.getCustomerPortalUrl(customer_id)` → `{ url }`.
- **`POST /billing/webhook/lemonsqueezy`** — **public, unauth'd** (no
  `authMiddleware`, no `Bearer`). Uses the **raw** body:
  1. `verifyWebhook(raw, sig)` → 401 on mismatch, before any parse.
  2. `parseWebhookEvent(raw)` → `BillingEvent | null`; `null` → 200 (ack+ignore).
  3. Hand the event to the applier.
  4. Always 200 on a handled event so LS stops retrying.

## The applier — sole writer of entitlement

`apps/api/src/lib/billing/apply-event.ts`, provider-neutral, the only code that
writes both the `Subscription` and `Org.plan`:

```
activated  -> SubscriptionRepo.upsertFromEvent(status=active)
              OrgRepo.setPlan(orgId, tier)
updated    -> lookup by subId -> upsert(status, tier, period_end)
              status active|past_due -> setPlan(org, tier)   (keep access during dunning)
              status cancelled|expired -> handled by their own events (no-op here)
cancelled  -> lookup by subId -> mark status 'cancelled'
              (plan UNCHANGED — access lasts until period end)
expired    -> lookup by subId -> mark status 'expired'
              setPlan(org, 'free')                  (the actual downgrade)
```

- **Access-until-expiry:** LS `cancelled` fires at cancel time; the paid period
  runs to `current_period_end`. So `cancelled` is a status change only; the
  downgrade to `free` happens on `expired`.
- **Idempotent:** `upsertFromEvent` keys on `provider_subscription_id`; LS
  webhooks are at-least-once, so replays converge to the same state.
- **Lookup miss** on `updated/cancelled/expired` (never-seen sub) → log + no-op,
  no crash.
- Reuses the existing `OrgRepo.setPlan` — the `db set-plan` CLI escape hatch and
  the webhook now share one entitlement-flip path.

## Frontend (`apps/web`)

- Billing/upgrade surface with two CTAs (Paid, Paid+Expert): each calls
  `api.api.v0.billing.checkout.$post({ json: { tier } })` then
  `window.location = url`.
- Existing **402 → route-to-billing** gate lands here.
- **"Manage billing"** link (settings) → `billing.portal.$post` → redirect.
- **Return handling:** entitlement flip is driven by the **webhook, not the LS
  redirect** (redirect can beat the webhook). Success page re-fetches
  `/core/status` and briefly polls "activating…" if not yet paid — same pattern
  as the scan-status poll. No trust in redirect params.

## Config & security

- Non-secret env in `config.ts`: `LEMONSQUEEZY_STORE_ID`,
  `LEMONSQUEEZY_VARIANT_PAID`, `LEMONSQUEEZY_VARIANT_EXPERT`.
- Secrets via SSM SecureString (JWT-secret pattern, cached ~1h),
  **API Lambda only, never the worker**: `LEMONSQUEEZY_API_KEY`,
  `LEMONSQUEEZY_WEBHOOK_SECRET`. Local dev falls back to plain env vars.
- Extend `infra preflight` CLI to assert both SSM params exist before deploy.
- Webhook signature verified over the **raw** body byte-for-byte (grab raw text
  in the handler, not parsed JSON).
- `org_id` from checkout custom data trusted **only on `activated`**; later
  events resolve org via stored `Subscription`.
- The webhook is the one public route in an otherwise `Bearer`-gated API —
  explicitly no `authMiddleware`.

## Testing

**Unit (no infra):**

- `lemonsqueezy` impl: `verifyWebhook` valid/tampered/wrong-secret;
  `parseWebhookEvent` each LS fixture → correct `BillingEvent`, unknown
  variant/event → `null`; `createCheckout` embeds `org_id` + returns URL.
- Applier (mocked repos): `activated` → active + `setPlan(tier)`; `cancelled` →
  status only, **plan unchanged**; `expired` → `setPlan('free')`; `updated`
  paid→expert → `setPlan('expert')`; same `activated` twice converges; lookup
  miss → no-op.
- Routes via `testClient<AppType>(app)`: checkout unauth 401 / happy `{ url }` /
  already-paid 409; webhook bad-sig 401 / valid activated 200+applier / unknown
  200 no-op; portal no-sub 404.

**Integration (real Mongo):** `SubscriptionRepo` upsert idempotency on
`provider_subscription_id`, `findBy*`, unique-index enforcement.

**Entitlement regression:** `isPaid`/`hasExpert` truth table across
`free|paid|expert`; confirm `loadOwnedPaidOrg` treats `expert` as paid.

## Future Stripe switch (what this buys us)

Add a `stripe` impl of `BillingProvider` + a `/billing/webhook/stripe` route path
+ a `variant/price`→tier map, and migrate existing subscriber rows. **No changes**
to entitlement gates, `SubscriptionRepo`, the applier, or the frontend contract.
Recreate promo codes as Stripe coupons. The Merchant-of-Record vs payment-processor
difference (tax/compliance) is a business decision, not a code one.
