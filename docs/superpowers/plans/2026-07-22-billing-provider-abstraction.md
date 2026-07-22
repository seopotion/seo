# Billing (LemonSqueezy, provider-abstracted) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real billing system so `free` orgs can pay to unlock gated features, shipping LemonSqueezy behind a provider abstraction so a future Stripe switch is an additive adapter + config change.

**Architecture:** `Org.plan` (`free|paid|expert`) stays the provider-neutral entitlement source of truth. A separate `Subscription` collection holds provider-specific state. A thin `BillingProvider` adapter (LemonSqueezy impl) translates provider checkout/webhooks into an internal `BillingEvent` vocabulary; a provider-neutral applier is the sole writer of `Subscription` + `Org.plan`. One provider is live at a time.

**Tech Stack:** TypeScript, Zod 4, `@hono/zod-openapi` (OpenAPIHono), mongodb driver 7, Vitest 4, Node `crypto` (HMAC), AWS SSM (Powertools Parameters), CDK (`NodejsFunction`), Next.js 16 (`apps/web`).

## Global Constraints

- Entitlement enum is exactly `['free', 'paid', 'expert'] as const` — `trial` is dropped (pre-alpha, no backward-compat).
- `isPaid(org)` = `plan === 'paid' || plan === 'expert'`; every existing paid gate must keep working for `expert`.
- Provider is `'lemonsqueezy'` only; the interface and event vocabulary must carry no LemonSqueezy-specific types so a `'stripe'` impl can be added later with no changes to gates, `SubscriptionRepo`, the applier, or the frontend contract.
- Secrets (`LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`) resolve via SSM SecureString in deployed envs (Powertools, cached ~1h) with a plain-env-var local fallback — **granted to the API Lambda ONLY, never the worker**, mirroring `apps/api/src/auth/secret.ts`.
- `cancelled` is a status change only; the downgrade to `free` happens on `expired`. `past_due` keeps access (dunning).
- All `OpenAPIHono`, never plain `Hono`. Zod API schemas use `.openapi('Name')`. Biome: single quotes, 2-space indent, 100-char width. Shared packages export TS source; `import type`/`export type` for type-only imports (`verbatimModuleSyntax`).
- Dates on entities are `z.date()` (Date objects), matching `OrgSchema`.
- Gates: run `npm run lint`, `npm run check:all`, `npm test` before claiming any task done; `npm run test:integration` (needs `docker compose up -d mongo`) for repo integration tasks.

---

## File structure

- `packages/shared/types/src/index.ts` — modify: enum `free|paid|expert`.
- `packages/shared/schemas/src/org.ts` — modify: `isPaid` + new `hasExpert`.
- `packages/shared/schemas/src/subscription.ts` — create: `SubscriptionSchema`, statuses, tiers.
- `packages/shared/schemas/src/index.ts` — modify: export subscription.
- `packages/shared/db/src/repositories/subscription.repo.ts` — create: `SubscriptionRepo`.
- `packages/shared/db/src/index.ts` — modify: export `SubscriptionRepo`.
- `packages/shared/db/src/ensure-indexes.ts` — modify: subscription indexes.
- `packages/shared/providers/src/billing/types.ts` — create: `BillingProvider`, `BillingEvent`.
- `packages/shared/providers/src/billing/lemonsqueezy.ts` — create: LS impl.
- `packages/shared/providers/src/index.ts` — modify: export billing.
- `apps/api/src/lib/billing/apply-event.ts` — create: applier.
- `apps/api/src/clients/billing.ts` — create: module-scoped provider instance.
- `apps/api/src/auth/secret.ts` — modify: add LS secret resolvers (or a sibling `billing/secret.ts`; see Task 7).
- `apps/api/src/config.ts` — modify: LS config keys.
- `apps/api/src/schemas/billing.ts` — create: request/response schemas.
- `apps/api/src/routes/billing.ts` — create: checkout/portal/webhook routes.
- `apps/api/src/routes/index.ts` — modify: mount billing router.
- `apps/cli/src/commands/db.ts` — modify: set-plan help text.
- `apps/web/...` — modify/create: upgrade CTAs, manage-billing link, activation poll (Task 8).
- `infra/lib/config.ts`, `infra/lib/api-stack.ts`, `apps/cli/src/lib/preflight.ts`, `infra/ENVIRONMENTS.md` — modify: SSM params + preflight (Task 9).
- Tests alongside: `packages/shared/schemas/tests/`, `packages/shared/db/tests/`, `packages/shared/providers/tests/`, `apps/api/tests/`.

---

## Task 1: Entitlement enum + `hasExpert`

**Files:**
- Modify: `packages/shared/types/src/index.ts:17`
- Modify: `packages/shared/schemas/src/org.ts` (the `isPaid` function at end of file)
- Modify: `packages/shared/schemas/tests/org.test.ts:21`
- Modify: `apps/cli/src/commands/db.ts:69`

**Interfaces:**
- Produces: `ENTITLEMENT_PLANS = ['free','paid','expert'] as const`; `type EntitlementPlan`; `isPaid(org: Org): boolean`; `hasExpert(org: Org): boolean`.

- [ ] **Step 1: Update the entitlement test to the new enum**

In `packages/shared/schemas/tests/org.test.ts`, replace the `isPaid` test block:

```ts
  test('isPaid is true for paid and expert, false for free', () => {
    expect(isPaid(OrgSchema.parse({ ...base, plan: 'paid' }))).toBe(true);
    expect(isPaid(OrgSchema.parse({ ...base, plan: 'expert' }))).toBe(true);
    expect(isPaid(OrgSchema.parse(base))).toBe(false);
  });

  test('hasExpert is true only for the expert plan', () => {
    expect(hasExpert(OrgSchema.parse({ ...base, plan: 'expert' }))).toBe(true);
    expect(hasExpert(OrgSchema.parse({ ...base, plan: 'paid' }))).toBe(false);
    expect(hasExpert(OrgSchema.parse(base))).toBe(false);
  });
```

And add `hasExpert` to the import at the top:

```ts
import { CreateOrgInput, hasExpert, isPaid, ONBOARDING_INTEGRATIONS, OrgSchema } from '../src/org';
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- org`
Expected: FAIL — `hasExpert` is not exported; `'expert'` not a valid enum value yet.

- [ ] **Step 3: Update the enum**

In `packages/shared/types/src/index.ts`, replace line 16-18:

```ts
/** Billing entitlement plans. `paid`/`expert` unlock the automated pipeline (#56);
 * `expert` additionally grants human-operator assistance + extra features (#13). */
export const ENTITLEMENT_PLANS = ['free', 'paid', 'expert'] as const;
export type EntitlementPlan = (typeof ENTITLEMENT_PLANS)[number];
```

- [ ] **Step 4: Update the entitlement helpers**

In `packages/shared/schemas/src/org.ts`, replace the trailing `isPaid` function:

```ts
/** True when the org has an active paid entitlement (paid or expert). Backed by
 * billing webhooks (#13); the `db set-plan` CLI can also flip it. */
export function isPaid(org: Org): boolean {
  return org.plan === 'paid' || org.plan === 'expert';
}

/** True when the org is on the expert tier (human-operator assistance + extras). */
export function hasExpert(org: Org): boolean {
  return org.plan === 'expert';
}
```

- [ ] **Step 5: Update the CLI set-plan help text**

In `apps/cli/src/commands/db.ts:69`, change the description:

```ts
        plan: { type: 'string', description: 'free | paid | expert', default: 'paid' },
```

- [ ] **Step 6: Run tests + typecheck to verify they pass**

Run: `npm test -- org && npm run check`
Expected: PASS. (Typecheck confirms no remaining `'trial'` references break — the CLI `setOrgPlan` validates against `ENTITLEMENT_PLANS` and needs no change.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/types/src/index.ts packages/shared/schemas/src/org.ts packages/shared/schemas/tests/org.test.ts apps/cli/src/commands/db.ts
git commit -m "feat(billing): entitlement enum free|paid|expert + hasExpert (#13)"
```

---

## Task 2: Subscription schema

**Files:**
- Create: `packages/shared/schemas/src/subscription.ts`
- Modify: `packages/shared/schemas/src/index.ts`
- Test: `packages/shared/schemas/tests/subscription.test.ts`

**Interfaces:**
- Produces:
  - `SUBSCRIPTION_STATUSES = ['active','past_due','cancelled','expired'] as const`; `type SubscriptionStatus`.
  - `PAID_TIERS = ['paid','expert'] as const`; `type PaidTier`.
  - `SubscriptionSchema` (Zod) → `type Subscription`.
  - `CreateSubscriptionInput` (omits `id`) → `type CreateSubscriptionInput` (`z.input`).

- [ ] **Step 1: Write the failing test**

Create `packages/shared/schemas/tests/subscription.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { SubscriptionSchema } from '../src/subscription';

const base = {
  id: 's1',
  org_id: 'o1',
  provider: 'lemonsqueezy',
  provider_customer_id: 'cust_1',
  provider_subscription_id: 'sub_1',
  tier: 'paid',
  status: 'active',
  current_period_end: new Date('2026-08-22T00:00:00Z'),
  created_at: new Date('2026-07-22T00:00:00Z'),
  updated_at: new Date('2026-07-22T00:00:00Z'),
};

describe('SubscriptionSchema', () => {
  test('parses a valid active subscription', () => {
    const sub = SubscriptionSchema.parse(base);
    expect(sub.tier).toBe('paid');
    expect(sub.status).toBe('active');
    expect(sub.current_period_end).toBeInstanceOf(Date);
  });

  test('accepts the expert tier', () => {
    expect(SubscriptionSchema.parse({ ...base, tier: 'expert' }).tier).toBe('expert');
  });

  test('rejects an unknown status', () => {
    expect(() => SubscriptionSchema.parse({ ...base, status: 'paused' })).toThrow();
  });

  test('rejects a free tier (subscriptions are only paid tiers)', () => {
    expect(() => SubscriptionSchema.parse({ ...base, tier: 'free' })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- subscription`
Expected: FAIL — cannot find `../src/subscription`.

- [ ] **Step 3: Write the schema**

Create `packages/shared/schemas/src/subscription.ts`:

```ts
import { z } from 'zod';

/** Provider-neutral subscription lifecycle status. */
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Paid entitlement tiers a subscription can grant (never `free`). */
export const PAID_TIERS = ['paid', 'expert'] as const;
export type PaidTier = (typeof PAID_TIERS)[number];

/**
 * A billing subscription for an org. Provider-specific ids live here; the
 * neutral entitlement (`Org.plan`) is derived from `tier` + `status` by the
 * applier. `provider` widens to 'stripe' later with no schema change.
 * See design/../specs/2026-07-22-billing-provider-abstraction-design.md.
 */
export const SubscriptionSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  provider: z.enum(['lemonsqueezy']),
  provider_customer_id: z.string(),
  provider_subscription_id: z.string(),
  tier: z.enum(PAID_TIERS),
  status: z.enum(SUBSCRIPTION_STATUSES),
  current_period_end: z.date(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

/** Input for creating a subscription — the server assigns `id`. */
export const CreateSubscriptionInput = SubscriptionSchema.omit({ id: true });
export type CreateSubscriptionInput = z.input<typeof CreateSubscriptionInput>;
```

- [ ] **Step 4: Export from the schemas barrel**

In `packages/shared/schemas/src/index.ts`, add (keep alphabetical, after `./scan`):

```ts
export * from './subscription';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- subscription`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/schemas/src/subscription.ts packages/shared/schemas/src/index.ts packages/shared/schemas/tests/subscription.test.ts
git commit -m "feat(billing): Subscription schema (#13)"
```

---

## Task 3: SubscriptionRepo + indexes

**Files:**
- Create: `packages/shared/db/src/repositories/subscription.repo.ts`
- Modify: `packages/shared/db/src/index.ts`
- Modify: `packages/shared/db/src/ensure-indexes.ts`
- Test (integration): `packages/shared/db/tests/subscription.repo.integration.test.ts`

**Interfaces:**
- Consumes: `Subscription`, `SubscriptionSchema`, `CreateSubscriptionInput`, `SubscriptionStatus`, `PaidTier` (Task 2).
- Produces `SubscriptionRepo` with:
  - `findByProviderSubscriptionId(providerSubscriptionId: string): Promise<Subscription | null>`
  - `findActiveByOrg(org_id: string): Promise<Subscription | null>`
  - `upsertFromEvent(input: { org_id: string; provider: 'lemonsqueezy'; provider_customer_id: string; provider_subscription_id: string; tier: PaidTier; status: SubscriptionStatus; current_period_end: Date }): Promise<Subscription>` — idempotent upsert keyed on `provider_subscription_id`.
  - `updateFromEvent(input: { provider_subscription_id: string; tier?: PaidTier; status: SubscriptionStatus; current_period_end?: Date }): Promise<Subscription | null>` — updates an existing sub; returns `null` if none.

- [ ] **Step 1: Write the failing integration test**

Create `packages/shared/db/tests/subscription.repo.integration.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { SubscriptionRepo } from '../src/repositories/subscription.repo';

const evt = (over: Record<string, unknown> = {}) => ({
  org_id: 'o1',
  provider: 'lemonsqueezy' as const,
  provider_customer_id: 'cust_1',
  provider_subscription_id: 'sub_1',
  tier: 'paid' as const,
  status: 'active' as const,
  current_period_end: new Date('2026-08-22T00:00:00Z'),
  ...over,
});

describe('SubscriptionRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('subscriptions').deleteMany({});
  });
  afterAll(async () => {
    await closeDb();
  });

  test('upsertFromEvent inserts then is idempotent on provider_subscription_id', async () => {
    const a = await SubscriptionRepo.upsertFromEvent(evt());
    expect(a.id).toMatch(/^[a-f0-9]{24}$/);
    const b = await SubscriptionRepo.upsertFromEvent(evt({ status: 'past_due' }));
    expect(b.id).toBe(a.id); // same doc, not a duplicate
    expect(b.status).toBe('past_due');
    const db = await getDb();
    expect(await db.collection('subscriptions').countDocuments({})).toBe(1);
  });

  test('findByProviderSubscriptionId + findActiveByOrg', async () => {
    const found = await SubscriptionRepo.findByProviderSubscriptionId('sub_1');
    expect(found?.org_id).toBe('o1');
    await SubscriptionRepo.upsertFromEvent(evt({ status: 'active' }));
    expect((await SubscriptionRepo.findActiveByOrg('o1'))?.provider_subscription_id).toBe('sub_1');
  });

  test('findActiveByOrg ignores cancelled/expired subs', async () => {
    await SubscriptionRepo.updateFromEvent({ provider_subscription_id: 'sub_1', status: 'expired' });
    expect(await SubscriptionRepo.findActiveByOrg('o1')).toBeNull();
  });

  test('updateFromEvent returns null for an unknown subscription', async () => {
    expect(
      await SubscriptionRepo.updateFromEvent({ provider_subscription_id: 'nope', status: 'active' }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose up -d mongo && npm run test:integration -- subscription`
Expected: FAIL — cannot find `../src/repositories/subscription.repo`.

- [ ] **Step 3: Write the repository**

Create `packages/shared/db/src/repositories/subscription.repo.ts`:

```ts
import {
  type CreateSubscriptionInput,
  type PaidTier,
  type Subscription,
  SubscriptionSchema,
  type SubscriptionStatus,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('subscriptions');

function toEntity(doc: WithId<Document>): Subscription {
  const { _id, ...rest } = doc;
  return SubscriptionSchema.parse({ id: _id.toString(), ...rest });
}

type UpsertInput = Omit<CreateSubscriptionInput, 'created_at' | 'updated_at'>;

export const SubscriptionRepo = {
  async findByProviderSubscriptionId(providerSubscriptionId: string): Promise<Subscription | null> {
    const doc = await (await collection()).findOne({
      provider_subscription_id: providerSubscriptionId,
    });
    return doc ? toEntity(doc) : null;
  },

  async findActiveByOrg(org_id: string): Promise<Subscription | null> {
    const doc = await (await collection()).findOne({ org_id, status: 'active' });
    return doc ? toEntity(doc) : null;
  },

  /**
   * Idempotent upsert keyed on `provider_subscription_id`. Sets `created_at`
   * only on insert; always bumps `updated_at`. Webhooks are at-least-once, so
   * replays converge to the same doc. Returns the resulting entity.
   */
  async upsertFromEvent(input: UpsertInput): Promise<Subscription> {
    const now = new Date();
    const res = await (await collection()).findOneAndUpdate(
      { provider_subscription_id: input.provider_subscription_id },
      {
        $set: {
          org_id: input.org_id,
          provider: input.provider,
          provider_customer_id: input.provider_customer_id,
          tier: input.tier,
          status: input.status,
          current_period_end: input.current_period_end,
          updated_at: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true, returnDocument: 'after' },
    );
    if (!res) throw new Error('upsertFromEvent: no document returned');
    return toEntity(res);
  },

  /**
   * Update an existing subscription in place (used for updated/cancelled/expired
   * events, which carry only the provider subscription id). Returns null when no
   * subscription matches — the applier treats that as a logged no-op.
   */
  async updateFromEvent(input: {
    provider_subscription_id: string;
    tier?: PaidTier;
    status: SubscriptionStatus;
    current_period_end?: Date;
  }): Promise<Subscription | null> {
    const set: Record<string, unknown> = { status: input.status, updated_at: new Date() };
    if (input.tier) set.tier = input.tier;
    if (input.current_period_end) set.current_period_end = input.current_period_end;
    const res = await (await collection()).findOneAndUpdate(
      { provider_subscription_id: input.provider_subscription_id },
      { $set: set },
      { returnDocument: 'after' },
    );
    return res ? toEntity(res) : null;
  },
};
```

- [ ] **Step 4: Export the repo and add indexes**

In `packages/shared/db/src/index.ts`, add after the `OrgRepo` export line:

```ts
export { SubscriptionRepo } from './repositories/subscription.repo';
```

In `packages/shared/db/src/ensure-indexes.ts`, add before the closing brace of `ensureIndexes`:

```ts
  // Billing (#13). Unique on the provider subscription id makes upsertFromEvent
  // idempotent under at-least-once webhooks; org_id index serves findActiveByOrg.
  await db
    .collection('subscriptions')
    .createIndex({ provider_subscription_id: 1 }, { unique: true });
  await db.collection('subscriptions').createIndex({ org_id: 1, status: 1 });
```

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `npm run db:init && npm run test:integration -- subscription`
Expected: PASS (4 tests). (`db:init` creates the new unique index.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/db/src/repositories/subscription.repo.ts packages/shared/db/src/index.ts packages/shared/db/src/ensure-indexes.ts packages/shared/db/tests/subscription.repo.integration.test.ts
git commit -m "feat(billing): SubscriptionRepo + indexes (#13)"
```

---

## Task 4: BillingProvider interface + BillingEvent vocabulary

**Files:**
- Create: `packages/shared/providers/src/billing/types.ts`
- Modify: `packages/shared/providers/src/index.ts`

**Interfaces:**
- Consumes: `PaidTier`, `SubscriptionStatus` (Task 2, via `@shared/schemas`).
- Produces:
  - `type BillingEvent` (4 variants below).
  - `interface BillingProvider` with `name`, `createCheckout`, `verifyWebhook`, `parseWebhookEvent`, `getCustomerPortalUrl`.

- [ ] **Step 1: Write the types (no test — pure type declarations)**

Create `packages/shared/providers/src/billing/types.ts`:

```ts
import type { PaidTier, SubscriptionStatus } from '@shared/schemas';

/**
 * Provider-neutral billing events. Every provider's webhook parser emits these;
 * the applier consumes only these and never a LemonSqueezy/Stripe payload.
 *
 * `activated` carries `orgId` (from checkout custom data) — the one time we learn
 * org<->subscription. Later events carry only `providerSubscriptionId`; the
 * applier resolves the org via the stored Subscription, so a forged later
 * payload cannot move another org's entitlement.
 */
export type BillingEvent =
  | {
      type: 'subscription_activated';
      orgId: string;
      providerCustomerId: string;
      providerSubscriptionId: string;
      tier: PaidTier;
      currentPeriodEnd: Date;
    }
  | {
      type: 'subscription_updated';
      providerSubscriptionId: string;
      tier: PaidTier;
      status: SubscriptionStatus;
      currentPeriodEnd: Date;
    }
  | { type: 'subscription_cancelled'; providerSubscriptionId: string }
  | { type: 'subscription_expired'; providerSubscriptionId: string };

/** A swappable billing backend. One implementation is live at a time. */
export interface BillingProvider {
  readonly name: 'lemonsqueezy';

  /** Create a hosted checkout for a tier; embeds `orgId` for round-trip correlation. */
  createCheckout(input: {
    tier: PaidTier;
    orgId: string;
    userEmail: string;
  }): Promise<{ url: string }>;

  /** Verify the provider signature over the RAW request body. */
  verifyWebhook(rawBody: string, signature: string): boolean;

  /** Translate a verified provider payload into a BillingEvent, or null to ignore. */
  parseWebhookEvent(rawBody: string): BillingEvent | null;

  /** "Manage billing" link (cancel / update card). */
  getCustomerPortalUrl(providerCustomerId: string): Promise<{ url: string }>;
}
```

- [ ] **Step 2: Export from the providers barrel**

In `packages/shared/providers/src/index.ts`, add at the top of the export list:

```ts
export type * from './billing/types';
```

- [ ] **Step 3: Typecheck to verify it compiles**

Run: `npm run check`
Expected: PASS (no type errors).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/providers/src/billing/types.ts packages/shared/providers/src/index.ts
git commit -m "feat(billing): BillingProvider interface + BillingEvent vocabulary (#13)"
```

---

## Task 5: LemonSqueezy provider implementation

**Files:**
- Create: `packages/shared/providers/src/billing/lemonsqueezy.ts`
- Modify: `packages/shared/providers/src/index.ts`
- Test: `packages/shared/providers/tests/lemonsqueezy.test.ts`

**Interfaces:**
- Consumes: `BillingProvider`, `BillingEvent` (Task 4), `PaidTier`, `SubscriptionStatus` (Task 2).
- Produces: `createLemonSqueezyProvider(cfg: LemonSqueezyConfig): BillingProvider`, where
  ```ts
  interface LemonSqueezyConfig {
    apiKey: string;
    webhookSecret: string;
    storeId: string;
    variantByTier: Record<PaidTier, string>; // LS variant id per tier
  }
  ```

- [ ] **Step 1: Write the failing tests**

Create `packages/shared/providers/tests/lemonsqueezy.test.ts`:

```ts
import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLemonSqueezyProvider } from '../src/billing/lemonsqueezy';

const cfg = {
  apiKey: 'test-key',
  webhookSecret: 'whsec_test',
  storeId: '111',
  variantByTier: { paid: '201', expert: '202' } as const,
};
const provider = createLemonSqueezyProvider(cfg);

const sign = (body: string) => createHmac('sha256', cfg.webhookSecret).update(body).digest('hex');

// Minimal LS webhook body: meta.event_name + meta.custom_data + data.
const wh = (over: {
  event: string;
  variantId?: string;
  status?: string;
  orgId?: string;
  subId?: string;
  customerId?: number;
}) =>
  JSON.stringify({
    meta: {
      event_name: over.event,
      custom_data: over.orgId ? { org_id: over.orgId } : undefined,
    },
    data: {
      id: over.subId ?? 'sub_1',
      attributes: {
        customer_id: over.customerId ?? 55,
        variant_id: Number(over.variantId ?? '201'),
        status: over.status ?? 'active',
        renews_at: '2026-08-22T00:00:00.000000Z',
      },
    },
  });

describe('lemonsqueezy verifyWebhook', () => {
  test('accepts a correct signature', () => {
    const body = wh({ event: 'subscription_created', orgId: 'o1' });
    expect(provider.verifyWebhook(body, sign(body))).toBe(true);
  });
  test('rejects a tampered body', () => {
    const body = wh({ event: 'subscription_created', orgId: 'o1' });
    expect(provider.verifyWebhook(`${body} `, sign(body))).toBe(false);
  });
  test('rejects a wrong secret', () => {
    const body = wh({ event: 'subscription_created', orgId: 'o1' });
    const bad = createHmac('sha256', 'nope').update(body).digest('hex');
    expect(provider.verifyWebhook(body, bad)).toBe(false);
  });
});

describe('lemonsqueezy parseWebhookEvent', () => {
  test('subscription_created -> activated with tier from variant + orgId', () => {
    const e = provider.parseWebhookEvent(
      wh({ event: 'subscription_created', variantId: '202', orgId: 'o1', subId: 'sub_9', customerId: 7 }),
    );
    expect(e).toEqual({
      type: 'subscription_activated',
      orgId: 'o1',
      providerCustomerId: '7',
      providerSubscriptionId: 'sub_9',
      tier: 'expert',
      currentPeriodEnd: new Date('2026-08-22T00:00:00.000000Z'),
    });
  });
  test('subscription_updated past_due -> updated with mapped status', () => {
    const e = provider.parseWebhookEvent(
      wh({ event: 'subscription_updated', variantId: '201', status: 'past_due', subId: 'sub_9' }),
    );
    expect(e).toMatchObject({ type: 'subscription_updated', providerSubscriptionId: 'sub_9', tier: 'paid', status: 'past_due' });
  });
  test('subscription_cancelled -> cancelled (sub id only)', () => {
    const e = provider.parseWebhookEvent(wh({ event: 'subscription_cancelled', subId: 'sub_9' }));
    expect(e).toEqual({ type: 'subscription_cancelled', providerSubscriptionId: 'sub_9' });
  });
  test('subscription_expired -> expired', () => {
    const e = provider.parseWebhookEvent(wh({ event: 'subscription_expired', subId: 'sub_9' }));
    expect(e).toEqual({ type: 'subscription_expired', providerSubscriptionId: 'sub_9' });
  });
  test('unknown variant -> null', () => {
    expect(provider.parseWebhookEvent(wh({ event: 'subscription_created', variantId: '999', orgId: 'o1' }))).toBeNull();
  });
  test('unhandled event name -> null', () => {
    expect(provider.parseWebhookEvent(wh({ event: 'order_created' }))).toBeNull();
  });
});

describe('lemonsqueezy createCheckout', () => {
  afterEach(() => vi.restoreAllMocks());
  test('POSTs a checkout with org_id in custom data and returns the url', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { attributes: { url: 'https://ls/checkout/abc' } } }), {
        status: 201,
      }),
    );
    const { url } = await provider.createCheckout({ tier: 'paid', orgId: 'o1', userEmail: 'u@e.com' });
    expect(url).toBe('https://ls/checkout/abc');
    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse(String(init?.body));
    expect(sent.data.attributes.checkout_data.custom).toEqual({ org_id: 'o1' });
    expect(sent.data.attributes.checkout_data.email).toBe('u@e.com');
    expect(sent.data.relationships.variant.data.id).toBe('201');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lemonsqueezy`
Expected: FAIL — cannot find `../src/billing/lemonsqueezy`.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/providers/src/billing/lemonsqueezy.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaidTier, SubscriptionStatus } from '@shared/schemas';
import type { BillingEvent, BillingProvider } from './types';

const LS_API = 'https://api.lemonsqueezy.com/v1';
const JSON_API = 'application/vnd.api+json';

export interface LemonSqueezyConfig {
  apiKey: string;
  webhookSecret: string;
  storeId: string;
  variantByTier: Record<PaidTier, string>;
}

/** Map a LemonSqueezy subscription status to our neutral status. */
function mapStatus(ls: string): SubscriptionStatus {
  switch (ls) {
    case 'active':
    case 'on_trial':
      return 'active';
    case 'past_due':
    case 'unpaid':
    case 'paused':
      return 'past_due';
    case 'cancelled':
      return 'cancelled';
    case 'expired':
      return 'expired';
    default:
      return 'past_due';
  }
}

export function createLemonSqueezyProvider(cfg: LemonSqueezyConfig): BillingProvider {
  // Reverse map: LS variant id (string) -> our tier.
  const tierByVariant = new Map<string, PaidTier>(
    (Object.entries(cfg.variantByTier) as [PaidTier, string][]).map(([tier, id]) => [id, tier]),
  );

  return {
    name: 'lemonsqueezy',

    async createCheckout({ tier, orgId, userEmail }) {
      const res = await fetch(`${LS_API}/checkouts`, {
        method: 'POST',
        headers: {
          Accept: JSON_API,
          'Content-Type': JSON_API,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: 'checkouts',
            attributes: {
              checkout_data: { email: userEmail, custom: { org_id: orgId } },
            },
            relationships: {
              store: { data: { type: 'stores', id: cfg.storeId } },
              variant: { data: { type: 'variants', id: cfg.variantByTier[tier] } },
            },
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`LemonSqueezy checkout failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { data: { attributes: { url: string } } };
      return { url: json.data.attributes.url };
    },

    verifyWebhook(rawBody, signature) {
      const expected = createHmac('sha256', cfg.webhookSecret).update(rawBody).digest('hex');
      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(signature, 'utf8');
      return a.length === b.length && timingSafeEqual(a, b);
    },

    parseWebhookEvent(rawBody) {
      const payload = JSON.parse(rawBody) as {
        meta: { event_name: string; custom_data?: { org_id?: string } };
        data: {
          id: string;
          attributes: { customer_id: number; variant_id: number; status: string; renews_at: string };
        };
      };
      const event = payload.meta.event_name;
      const subId = payload.data.id;
      const attrs = payload.data.attributes;

      switch (event) {
        case 'subscription_created': {
          const tier = tierByVariant.get(String(attrs.variant_id));
          const orgId = payload.meta.custom_data?.org_id;
          if (!tier || !orgId) return null;
          return {
            type: 'subscription_activated',
            orgId,
            providerCustomerId: String(attrs.customer_id),
            providerSubscriptionId: subId,
            tier,
            currentPeriodEnd: new Date(attrs.renews_at),
          };
        }
        case 'subscription_updated': {
          const tier = tierByVariant.get(String(attrs.variant_id));
          if (!tier) return null;
          return {
            type: 'subscription_updated',
            providerSubscriptionId: subId,
            tier,
            status: mapStatus(attrs.status),
            currentPeriodEnd: new Date(attrs.renews_at),
          };
        }
        case 'subscription_cancelled':
          return { type: 'subscription_cancelled', providerSubscriptionId: subId };
        case 'subscription_expired':
          return { type: 'subscription_expired', providerSubscriptionId: subId };
        default:
          return null;
      }
    },

    async getCustomerPortalUrl(providerCustomerId) {
      const res = await fetch(`${LS_API}/customers/${providerCustomerId}`, {
        headers: { Accept: JSON_API, Authorization: `Bearer ${cfg.apiKey}` },
      });
      if (!res.ok) {
        throw new Error(`LemonSqueezy customer fetch failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as {
        data: { attributes: { urls: { customer_portal: string } } };
      };
      return { url: json.data.attributes.urls.customer_portal };
    },
  };
}
```

- [ ] **Step 4: Export the factory**

In `packages/shared/providers/src/index.ts`, add below the `export type * from './billing/types'` line:

```ts
export { createLemonSqueezyProvider, type LemonSqueezyConfig } from './billing/lemonsqueezy';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- lemonsqueezy`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/providers/src/billing/lemonsqueezy.ts packages/shared/providers/src/index.ts packages/shared/providers/tests/lemonsqueezy.test.ts
git commit -m "feat(billing): LemonSqueezy provider impl (#13)"
```

---

## Task 6: The applier (provider-neutral)

**Files:**
- Create: `apps/api/src/lib/billing/apply-event.ts`
- Test: `apps/api/tests/apply-billing-event.test.ts`

**Interfaces:**
- Consumes: `BillingEvent` (Task 4), `SubscriptionRepo` (Task 3), `OrgRepo.setPlan` (existing).
- Produces: `applyBillingEvent(event: BillingEvent): Promise<void>` — the sole writer of `Subscription` + `Org.plan`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/apply-billing-event.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { upsertFromEvent, updateFromEvent, setPlan } = vi.hoisted(() => ({
  upsertFromEvent: vi.fn(),
  updateFromEvent: vi.fn(),
  setPlan: vi.fn(),
}));
vi.mock('@shared/db', () => ({
  SubscriptionRepo: { upsertFromEvent, updateFromEvent },
  OrgRepo: { setPlan },
}));

import { applyBillingEvent } from '../src/lib/billing/apply-event';

const periodEnd = new Date('2026-08-22T00:00:00Z');

describe('applyBillingEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  test('activated: upserts active sub and sets plan to the tier', async () => {
    upsertFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent({
      type: 'subscription_activated',
      orgId: 'o1',
      providerCustomerId: 'c1',
      providerSubscriptionId: 'sub_1',
      tier: 'expert',
      currentPeriodEnd: periodEnd,
    });
    expect(upsertFromEvent).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'o1', provider_subscription_id: 'sub_1', tier: 'expert', status: 'active' }),
    );
    expect(setPlan).toHaveBeenCalledWith('o1', 'expert');
  });

  test('updated active: keeps plan on the tier', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent({
      type: 'subscription_updated',
      providerSubscriptionId: 'sub_1',
      tier: 'paid',
      status: 'active',
      currentPeriodEnd: periodEnd,
    });
    expect(setPlan).toHaveBeenCalledWith('o1', 'paid');
  });

  test('updated past_due: keeps access (plan stays on tier during dunning)', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent({
      type: 'subscription_updated',
      providerSubscriptionId: 'sub_1',
      tier: 'paid',
      status: 'past_due',
      currentPeriodEnd: periodEnd,
    });
    expect(setPlan).toHaveBeenCalledWith('o1', 'paid');
  });

  test('cancelled: marks sub cancelled but leaves plan unchanged', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent({ type: 'subscription_cancelled', providerSubscriptionId: 'sub_1' });
    expect(updateFromEvent).toHaveBeenCalledWith({ provider_subscription_id: 'sub_1', status: 'cancelled' });
    expect(setPlan).not.toHaveBeenCalled();
  });

  test('expired: downgrades plan to free', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent({ type: 'subscription_expired', providerSubscriptionId: 'sub_1' });
    expect(updateFromEvent).toHaveBeenCalledWith({ provider_subscription_id: 'sub_1', status: 'expired' });
    expect(setPlan).toHaveBeenCalledWith('o1', 'free');
  });

  test('lookup miss on expired: no throw, no setPlan', async () => {
    updateFromEvent.mockResolvedValueOnce(null);
    await expect(
      applyBillingEvent({ type: 'subscription_expired', providerSubscriptionId: 'ghost' }),
    ).resolves.toBeUndefined();
    expect(setPlan).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- apply-billing-event`
Expected: FAIL — cannot find `../src/lib/billing/apply-event`.

- [ ] **Step 3: Write the applier**

Create `apps/api/src/lib/billing/apply-event.ts`:

```ts
import { OrgRepo, SubscriptionRepo } from '@shared/db';
import type { BillingEvent } from '@shared/providers';

/**
 * Apply a provider-neutral billing event: the sole writer of both the
 * Subscription record and the org's entitlement (`Org.plan`). Idempotent —
 * webhooks are at-least-once. See the billing design spec.
 *
 * Access-until-expiry: `cancelled` only marks the subscription; the plan stays
 * until the paid period ends, when `expired` downgrades to `free`. `past_due`
 * keeps access (dunning).
 */
export async function applyBillingEvent(event: BillingEvent): Promise<void> {
  switch (event.type) {
    case 'subscription_activated': {
      await SubscriptionRepo.upsertFromEvent({
        org_id: event.orgId,
        provider: 'lemonsqueezy',
        provider_customer_id: event.providerCustomerId,
        provider_subscription_id: event.providerSubscriptionId,
        tier: event.tier,
        status: 'active',
        current_period_end: event.currentPeriodEnd,
      });
      await OrgRepo.setPlan(event.orgId, event.tier);
      return;
    }
    case 'subscription_updated': {
      const sub = await SubscriptionRepo.updateFromEvent({
        provider_subscription_id: event.providerSubscriptionId,
        tier: event.tier,
        status: event.status,
        current_period_end: event.currentPeriodEnd,
      });
      if (!sub) return; // never-seen subscription: logged no-op
      // active or past_due (dunning) keep access; cancelled/expired arrive via
      // their own events, so we don't downgrade here.
      if (event.status === 'active' || event.status === 'past_due') {
        await OrgRepo.setPlan(sub.org_id, event.tier);
      }
      return;
    }
    case 'subscription_cancelled': {
      // Status change only — access lasts until `expired`.
      await SubscriptionRepo.updateFromEvent({
        provider_subscription_id: event.providerSubscriptionId,
        status: 'cancelled',
      });
      return;
    }
    case 'subscription_expired': {
      const sub = await SubscriptionRepo.updateFromEvent({
        provider_subscription_id: event.providerSubscriptionId,
        status: 'expired',
      });
      if (!sub) return;
      await OrgRepo.setPlan(sub.org_id, 'free');
      return;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- apply-billing-event`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/billing/apply-event.ts apps/api/tests/apply-billing-event.test.ts
git commit -m "feat(billing): provider-neutral event applier (#13)"
```

---

## Task 7: Config, secret resolver, provider client, and billing routes

**Files:**
- Modify: `apps/api/src/config.ts`
- Create: `apps/api/src/clients/billing.ts`
- Create: `apps/api/src/schemas/billing.ts`
- Create: `apps/api/src/routes/billing.ts`
- Modify: `apps/api/src/routes/index.ts`
- Test: `apps/api/tests/billing.test.ts`

**Interfaces:**
- Consumes: `createLemonSqueezyProvider` (Task 5), `applyBillingEvent` (Task 6), `loadOwnedOrg` (existing), `SubscriptionRepo` (Task 3), `isPaid` (Task 1), `getParameter` (Powertools, as in `auth/secret.ts`).
- Produces: billing router mounted at `/api/v0/billing` with `POST /checkout`, `POST /portal`, `POST /webhook/lemonsqueezy`; `getBillingProvider(): Promise<BillingProvider>`.

- [ ] **Step 1: Add config keys**

In `apps/api/src/config.ts`, add inside the `config` object (before `JWT_TTL_SECONDS`):

```ts
  /** Name of the SSM SecureString holding the LemonSqueezy API key (deployed).
   * Unset locally — LEMONSQUEEZY_API_KEY below is used directly. */
  LEMONSQUEEZY_API_KEY_PARAM: process.env.LEMONSQUEEZY_API_KEY_PARAM ?? '',
  /** Local-dev LemonSqueezy API key (#13). */
  LEMONSQUEEZY_API_KEY: process.env.LEMONSQUEEZY_API_KEY ?? '',
  /** Name of the SSM SecureString holding the LemonSqueezy webhook signing secret. */
  LEMONSQUEEZY_WEBHOOK_SECRET_PARAM: process.env.LEMONSQUEEZY_WEBHOOK_SECRET_PARAM ?? '',
  /** Local-dev LemonSqueezy webhook signing secret (#13). */
  LEMONSQUEEZY_WEBHOOK_SECRET: process.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '',
  /** LemonSqueezy store id (public, per-env). */
  LEMONSQUEEZY_STORE_ID: process.env.LEMONSQUEEZY_STORE_ID ?? '',
  /** LemonSqueezy variant ids per paid tier (public, per-env). */
  LEMONSQUEEZY_VARIANT_PAID: process.env.LEMONSQUEEZY_VARIANT_PAID ?? '',
  LEMONSQUEEZY_VARIANT_EXPERT: process.env.LEMONSQUEEZY_VARIANT_EXPERT ?? '',
```

- [ ] **Step 2: Write the provider client (SSM-resolved, module-scoped)**

Create `apps/api/src/clients/billing.ts`:

```ts
import { getParameter } from '@aws-lambda-powertools/parameters/ssm';
import { type BillingProvider, createLemonSqueezyProvider } from '@shared/providers';
import { config } from '../config';

const SECRET_MAX_AGE_SECONDS = 3600;

/** Resolve an SSM SecureString by name (deployed) or fall back to a plain env
 * value (local dev/tests) — mirrors auth/secret.ts. */
async function resolveSecret(paramName: string, fallback: string): Promise<string> {
  if (!paramName) return fallback;
  const value = await getParameter(paramName, { decrypt: true, maxAge: SECRET_MAX_AGE_SECONDS });
  if (!value) throw new Error(`SSM parameter ${paramName} is missing or empty`);
  return value;
}

let cached: BillingProvider | undefined;

/**
 * Module-scoped LemonSqueezy provider (warm-reuse across Lambda invocations).
 * Secrets resolve via SSM in deployed envs, plain env vars locally. API Lambda
 * only — the worker is never granted these params.
 */
export async function getBillingProvider(): Promise<BillingProvider> {
  if (cached) return cached;
  const [apiKey, webhookSecret] = await Promise.all([
    resolveSecret(config.LEMONSQUEEZY_API_KEY_PARAM, config.LEMONSQUEEZY_API_KEY),
    resolveSecret(config.LEMONSQUEEZY_WEBHOOK_SECRET_PARAM, config.LEMONSQUEEZY_WEBHOOK_SECRET),
  ]);
  cached = createLemonSqueezyProvider({
    apiKey,
    webhookSecret,
    storeId: config.LEMONSQUEEZY_STORE_ID,
    variantByTier: {
      paid: config.LEMONSQUEEZY_VARIANT_PAID,
      expert: config.LEMONSQUEEZY_VARIANT_EXPERT,
    },
  });
  return cached;
}
```

- [ ] **Step 3: Write the API schemas**

Create `apps/api/src/schemas/billing.ts`:

```ts
import { z } from '@hono/zod-openapi';
import { PAID_TIERS } from '@shared/schemas';

export const CheckoutBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    tier: z.enum(PAID_TIERS).openapi({ example: 'paid' }),
  })
  .openapi('CheckoutBody');

export const CheckoutResponse = z
  .object({ url: z.string().url().openapi({ example: 'https://store.lemonsqueezy.com/checkout/...' }) })
  .openapi('CheckoutResponse');

export const PortalBody = z
  .object({ org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }) })
  .openapi('PortalBody');

export const PortalResponse = z
  .object({ url: z.string().url().openapi({ example: 'https://store.lemonsqueezy.com/billing' }) })
  .openapi('PortalResponse');

export const WebhookResponse = z.object({ received: z.boolean() }).openapi('WebhookResponse');
```

- [ ] **Step 4: Write the failing route tests**

Create `apps/api/tests/billing.test.ts`:

```ts
import type { Context, Next } from 'hono';
import { testClient } from 'hono/testing';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { AuthEnv } from '../src/middlewares/auth';

const { loadOwnedOrg } = vi.hoisted(() => ({ loadOwnedOrg: vi.fn() }));
vi.mock('../src/lib/load-owned-org', () => ({ loadOwnedOrg }));

const { applyBillingEvent } = vi.hoisted(() => ({ applyBillingEvent: vi.fn() }));
vi.mock('../src/lib/billing/apply-event', () => ({ applyBillingEvent }));

const { findActiveByOrg } = vi.hoisted(() => ({ findActiveByOrg: vi.fn() }));
vi.mock('@shared/db', () => ({ SubscriptionRepo: { findActiveByOrg } }));

const { createCheckout, verifyWebhook, parseWebhookEvent, getCustomerPortalUrl } = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  verifyWebhook: vi.fn(),
  parseWebhookEvent: vi.fn(),
  getCustomerPortalUrl: vi.fn(),
}));
vi.mock('../src/clients/billing', () => ({
  getBillingProvider: async () => ({
    name: 'lemonsqueezy',
    createCheckout,
    verifyWebhook,
    parseWebhookEvent,
    getCustomerPortalUrl,
  }),
}));

vi.mock('../src/middlewares/auth', async (orig) => {
  const actual = await orig<typeof import('../src/middlewares/auth')>();
  return {
    ...actual,
    authMiddleware: async (c: Context<AuthEnv>, next: Next) => {
      c.set('auth', { userId: 'u1', email: 'u1@example.com' });
      await next();
    },
  };
});

import app from '../src/routes/billing';

describe('POST /checkout', () => {
  beforeEach(() => vi.clearAllMocks());

  test('403 when the org is not owned', async () => {
    loadOwnedOrg.mockResolvedValueOnce(null);
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(403);
  });

  test('409 when already paid on the same tier', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'paid' });
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(409);
  });

  test('200 returns the checkout url', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'free' });
    createCheckout.mockResolvedValueOnce({ url: 'https://ls/checkout/abc' });
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://ls/checkout/abc' });
    expect(createCheckout).toHaveBeenCalledWith({ tier: 'paid', orgId: 'o1', userEmail: 'u1@example.com' });
  });
});

describe('POST /portal', () => {
  beforeEach(() => vi.clearAllMocks());

  test('404 when there is no subscription', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'paid' });
    findActiveByOrg.mockResolvedValueOnce(null);
    const res = await testClient(app).portal.$post({ json: { org_id: 'o1' } });
    expect(res.status).toBe(404);
  });

  test('200 returns the portal url', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'paid' });
    findActiveByOrg.mockResolvedValueOnce({ provider_customer_id: 'c1' });
    getCustomerPortalUrl.mockResolvedValueOnce({ url: 'https://ls/billing' });
    const res = await testClient(app).portal.$post({ json: { org_id: 'o1' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://ls/billing' });
  });
});

describe('POST /webhook/lemonsqueezy', () => {
  beforeEach(() => vi.clearAllMocks());

  test('401 on a bad signature', async () => {
    verifyWebhook.mockReturnValueOnce(false);
    const res = await app.request('/webhook/lemonsqueezy', {
      method: 'POST',
      headers: { 'X-Signature': 'bad', 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });

  test('200 and applies a parsed event', async () => {
    verifyWebhook.mockReturnValueOnce(true);
    parseWebhookEvent.mockReturnValueOnce({ type: 'subscription_expired', providerSubscriptionId: 'sub_1' });
    const res = await app.request('/webhook/lemonsqueezy', {
      method: 'POST',
      headers: { 'X-Signature': 'good', 'Content-Type': 'application/json' },
      body: '{"meta":{}}',
    });
    expect(res.status).toBe(200);
    expect(applyBillingEvent).toHaveBeenCalledWith({ type: 'subscription_expired', providerSubscriptionId: 'sub_1' });
  });

  test('200 no-op on an unknown/ignored event', async () => {
    verifyWebhook.mockReturnValueOnce(true);
    parseWebhookEvent.mockReturnValueOnce(null);
    const res = await app.request('/webhook/lemonsqueezy', {
      method: 'POST',
      headers: { 'X-Signature': 'good', 'Content-Type': 'application/json' },
      body: '{"meta":{}}',
    });
    expect(res.status).toBe(200);
    expect(applyBillingEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test -- billing`
Expected: FAIL — cannot find `../src/routes/billing`.

- [ ] **Step 6: Write the billing router**

Create `apps/api/src/routes/billing.ts`:

```ts
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { SubscriptionRepo } from '@shared/db';
import { isPaid } from '@shared/schemas';
import { getBillingProvider } from '../clients/billing';
import { applyBillingEvent } from '../lib/billing/apply-event';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/billing';

/**
 * Billing routes (#13). Checkout + portal are Bearer-gated; the webhook is the
 * one public route (verified by provider signature, not a JWT). Chained
 * `.openapi()` so the type + spec capture every endpoint.
 */
const billing = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['billing'],
      method: 'post',
      path: '/checkout',
      summary: 'Create a hosted checkout for a paid tier',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.CheckoutBody } }, required: true },
      },
      responses: {
        200: { content: { 'application/json': { schema: schemas.CheckoutResponse } }, description: 'Checkout URL' },
        403: { description: 'Org not found or not owned by the caller' },
        409: { description: 'Already subscribed at this tier' },
      },
    }),
    async (c) => {
      const { org_id, tier } = c.req.valid('json');
      const { userId, email } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
      // Already entitled and buying the same tier -> send them to the portal instead.
      if (isPaid(org) && org.plan === tier) return c.body(null, 409);
      const provider = await getBillingProvider();
      const { url } = await provider.createCheckout({ tier, orgId: org.id, userEmail: email });
      return c.json({ url }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['billing'],
      method: 'post',
      path: '/portal',
      summary: 'Get the manage-billing portal URL',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.PortalBody } }, required: true },
      },
      responses: {
        200: { content: { 'application/json': { schema: schemas.PortalResponse } }, description: 'Portal URL' },
        403: { description: 'Org not found or not owned by the caller' },
        404: { description: 'No active subscription for this org' },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
      const sub = await SubscriptionRepo.findActiveByOrg(org.id);
      if (!sub) return c.body(null, 404);
      const provider = await getBillingProvider();
      const { url } = await provider.getCustomerPortalUrl(sub.provider_customer_id);
      return c.json({ url }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['billing'],
      method: 'post',
      path: '/webhook/lemonsqueezy',
      summary: 'LemonSqueezy webhook (public; signature-verified)',
      request: {
        body: { content: { 'application/json': { schema: schemas.WebhookResponse } }, required: false },
      },
      responses: {
        200: { content: { 'application/json': { schema: schemas.WebhookResponse } }, description: 'Acknowledged' },
        401: { description: 'Invalid signature' },
      },
    }),
    async (c) => {
      // Verify over the RAW body byte-for-byte — must read text, not parsed JSON.
      const raw = await c.req.text();
      const signature = c.req.header('X-Signature') ?? '';
      const provider = await getBillingProvider();
      if (!provider.verifyWebhook(raw, signature)) return c.body(null, 401);
      const event = provider.parseWebhookEvent(raw);
      if (event) await applyBillingEvent(event);
      return c.json({ received: true }, 200);
    },
  );

export default billing;
```

- [ ] **Step 7: Mount the router**

In `apps/api/src/routes/index.ts`, add the import (after `import core from './core';`):

```ts
import billing from './billing';
```

And add to the `routes` chain (after the `core` route, before `setup`):

```ts
  .route(`/api/${API_VERSION}/billing`, billing)
```

- [ ] **Step 8: Run tests + typecheck to verify they pass**

Run: `npm test -- billing && npm run check:all`
Expected: PASS (all billing route tests; typecheck confirms the mounted router flows into `AppType` so the frontend gets `api.api.v0.billing.*`).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/config.ts apps/api/src/clients/billing.ts apps/api/src/schemas/billing.ts apps/api/src/routes/billing.ts apps/api/src/routes/index.ts apps/api/tests/billing.test.ts
git commit -m "feat(billing): checkout/portal/webhook routes + provider client (#13)"
```

---

## Task 8: Frontend — upgrade CTAs, manage-billing link, activation poll

**Files:**
- Create: `apps/web/app/dashboard/billing/page.tsx` (upgrade surface)
- Modify: the dashboard settings surface to add a "Manage billing" link (locate the existing settings page under `apps/web/app/dashboard/` — follow its pattern).
- Modify: the existing 402 handler / product guard to route to `/dashboard/billing` (locate where `not_paid`/402 is currently handled in `apps/web`).

**Interfaces:**
- Consumes: typed client `api.api.v0.billing.checkout.$post`, `api.api.v0.billing.portal.$post`, `api.api.v0.core.status.$get` (existing).

> Before writing, read an existing dashboard page (e.g. `apps/web/app/dashboard/page.tsx`) and the API-client helper (`@shared/clients` `getApiClient`) to match auth-header attachment, the org-id source, and styling conventions. Follow those patterns exactly rather than introducing new ones.

- [ ] **Step 1: Build the upgrade page with two tier CTAs**

Create `apps/web/app/dashboard/billing/page.tsx`. It must:
- Render two CTAs: "Upgrade to Paid" (`tier: 'paid'`) and "Paid + Expert" (`tier: 'expert'`).
- On click: call `api.api.v0.billing.checkout.$post({ json: { org_id, tier } }, { headers: { Authorization: 'Bearer ' + token } })`, then `window.location.assign(url)`.
- Read `org_id` and the JWT from the same source the other dashboard pages use.

```tsx
'use client';
import { useState } from 'react';
// import the shared client + auth/org helpers the way the existing dashboard pages do
// (see apps/web/app/dashboard/page.tsx for the exact imports and token/org source).

const TIERS = [
  { tier: 'paid' as const, label: 'Upgrade to Paid' },
  { tier: 'expert' as const, label: 'Paid + Expert' },
];

export default function BillingPage() {
  const [busy, setBusy] = useState<string | null>(null);

  async function startCheckout(tier: 'paid' | 'expert') {
    setBusy(tier);
    try {
      // const res = await api.api.v0.billing.checkout.$post(
      //   { json: { org_id, tier } },
      //   { headers: { Authorization: `Bearer ${token}` } },
      // );
      // const { url } = await res.json();
      // window.location.assign(url);
    } finally {
      setBusy(null);
    }
  }

  return (
    <main>
      <h1>Choose your plan</h1>
      {TIERS.map(({ tier, label }) => (
        <button key={tier} disabled={busy !== null} onClick={() => startCheckout(tier)}>
          {busy === tier ? 'Redirecting…' : label}
        </button>
      ))}
    </main>
  );
}
```

Fill in the commented lines using the concrete client/token/org pattern from the existing dashboard pages.

- [ ] **Step 2: Add the return/activation poll**

The LS success redirect returns to the app; the plan flips via webhook, which can lag the redirect. On the billing success return (a `?checkout=success` query param on `/dashboard/billing`, set as the LS product's redirect URL), re-fetch `/core/status` and, while still not paid, show "Activating your subscription…" and poll every 2s (max ~30s) — reuse the existing scan-status poll pattern. On success, redirect to `/dashboard`.

- [ ] **Step 3: Add the "Manage billing" link**

In the settings surface, add a "Manage billing" button that calls `api.api.v0.billing.portal.$post({ json: { org_id } }, { headers: { Authorization } })` then `window.location.assign(url)`. Show it only when the org is paid (from cached `/core/status`).

- [ ] **Step 4: Route 402 to billing**

Where the frontend currently handles a `not_paid`/402 from a gated call, route the user to `/dashboard/billing`. (Search `apps/web` for the existing 402/`not_paid` handling and point it at the new page.)

- [ ] **Step 5: Verify the web build + typecheck**

Run: `npm run check:web && npm run --workspace apps/web build`
Expected: PASS — the typed client resolves `api.api.v0.billing.*` (proves Task 7's route feeds the client). Manually click through with `npm run dev` if practical.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(billing): upgrade CTAs, manage-billing link, activation poll (#13)"
```

---

## Task 9: Infra wiring + preflight

**Files:**
- Modify: `infra/lib/config.ts`
- Modify: `infra/lib/api-stack.ts`
- Modify: `apps/cli/src/lib/preflight.ts`
- Modify: `infra/ENVIRONMENTS.md`

**Interfaces:**
- Consumes: existing `STAGE_CONFIG`/SecureString wiring patterns.
- Produces: `LEMONSQUEEZY_*` env on the API Lambda; SSM read grants; preflight checks for the two new SecureStrings.

> `infra` is a standalone CDK package — run `cd infra && npm install` if not already done, and `cd infra && npx cdk synth` to verify.

- [ ] **Step 1: Add SSM param names + public values to STAGE_CONFIG**

In `infra/lib/config.ts`, add to the `StageConfig` interface:

```ts
  lemonSqueezyApiKeyParam: string; // SSM SecureString NAME
  lemonSqueezyWebhookSecretParam: string; // SSM SecureString NAME
  lemonSqueezyStoreId: string; // public
  lemonSqueezyVariantPaid: string; // public
  lemonSqueezyVariantExpert: string; // public
```

And to each stage (`staging`, `prod`) — use the stage in the param path and read public values from env:

```ts
    lemonSqueezyApiKeyParam: '/seo/staging/lemonsqueezy-api-key',
    lemonSqueezyWebhookSecretParam: '/seo/staging/lemonsqueezy-webhook-secret',
    lemonSqueezyStoreId: process.env.LEMONSQUEEZY_STORE_ID_STAGING ?? '',
    lemonSqueezyVariantPaid: process.env.LEMONSQUEEZY_VARIANT_PAID_STAGING ?? '',
    lemonSqueezyVariantExpert: process.env.LEMONSQUEEZY_VARIANT_EXPERT_STAGING ?? '',
```

(and the `prod` equivalents with `/seo/prod/...` and `*_PROD` env vars).

- [ ] **Step 2: Reference the SecureStrings + wire the API Lambda env**

In `infra/lib/api-stack.ts`, add two SecureString references next to the GSC ones:

```ts
    const lemonSqueezyApiKeyParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'LemonSqueezyApiKeyParam',
      { parameterName: cfg.lemonSqueezyApiKeyParam },
    );
    const lemonSqueezyWebhookSecretParam = StringParameter.fromSecureStringParameterAttributes(
      this,
      'LemonSqueezyWebhookSecretParam',
      { parameterName: cfg.lemonSqueezyWebhookSecretParam },
    );
```

Add to the `authEnv` object (API-Lambda-only, so the worker never receives them):

```ts
      LEMONSQUEEZY_API_KEY_PARAM: cfg.lemonSqueezyApiKeyParam,
      LEMONSQUEEZY_WEBHOOK_SECRET_PARAM: cfg.lemonSqueezyWebhookSecretParam,
      LEMONSQUEEZY_STORE_ID: cfg.lemonSqueezyStoreId,
      LEMONSQUEEZY_VARIANT_PAID: cfg.lemonSqueezyVariantPaid,
      LEMONSQUEEZY_VARIANT_EXPERT: cfg.lemonSqueezyVariantExpert,
```

And grant read to `apiFn` only, next to the other `grantRead(apiFn)` calls:

```ts
    lemonSqueezyApiKeyParam.grantRead(apiFn);
    lemonSqueezyWebhookSecretParam.grantRead(apiFn);
```

- [ ] **Step 3: Add the params to preflight**

In `apps/cli/src/lib/preflight.ts`, extend `ssmParamNames`:

```ts
function ssmParamNames(stage: Stage): string[] {
  return [
    `/seo/${stage}/jwt-secret`,
    `/seo/${stage}/mongo-uri`,
    `/seo/${stage}/google-client-secret`,
    `/seo/${stage}/gsc-token-key`,
    `/seo/${stage}/lemonsqueezy-api-key`,
    `/seo/${stage}/lemonsqueezy-webhook-secret`,
  ];
}
```

- [ ] **Step 4: Document the new prerequisites**

In `infra/ENVIRONMENTS.md`, add the two SecureStrings and the public LemonSqueezy env vars to the per-stage prerequisites list (mirror the GSC entries), including the `aws ssm put-parameter` commands:

```
aws ssm put-parameter --name /seo/<stage>/lemonsqueezy-api-key --type SecureString --value <ls_api_key>
aws ssm put-parameter --name /seo/<stage>/lemonsqueezy-webhook-secret --type SecureString --value <ls_webhook_secret>
```

- [ ] **Step 5: Verify synth + preflight typecheck**

Run: `cd infra && npx cdk synth >/dev/null && cd .. && npm run check`
Expected: PASS — synth produces a template; the API function has the new env vars and IAM read grants; the worker does not.

- [ ] **Step 6: Commit**

```bash
git add infra/lib/config.ts infra/lib/api-stack.ts apps/cli/src/lib/preflight.ts infra/ENVIRONMENTS.md
git commit -m "feat(billing): infra SSM wiring + preflight for LemonSqueezy (#13)"
```

---

## Task 10: Final verification + PROGRESS.md

**Files:**
- Modify: `PROGRESS.md`

- [ ] **Step 1: Run the full gate suite**

Run: `npm run lint && npm run check:all && npm test`
Then (Mongo up): `docker compose up -d mongo && npm run db:init && npm run test:integration`
Expected: all green.

- [ ] **Step 2: Update PROGRESS.md**

In `PROGRESS.md`, change the Dashboard billing line from:

```
- ⬜ Subscription (Free/Paid) + Stripe billing + promo codes — [#13](https://github.com/seopotion/seo/issues/13)
```

to:

```
- ✅ Billing: LemonSqueezy (provider-abstracted) — `free|paid|expert`, Subscription collection, checkout/portal/webhook, applier-driven entitlement; native LS promo codes; Stripe swap is an additive adapter — [#13](https://github.com/seopotion/seo/issues/13)
```

Update the `db set-plan` line under Local development to read `free|paid|expert` and note it remains a dev/staging override alongside real billing.

- [ ] **Step 3: Commit**

```bash
git add PROGRESS.md
git commit -m "docs: mark billing landed (#13)"
```

- [ ] **Step 4: Open the PR into `dev`**

```bash
git push -u origin faruk/billing-provider-abstraction
gh pr create --base dev --title "[billing] LemonSqueezy billing (provider-abstracted) + Paid/Expert tiers" \
  --body "Implements the billing design (docs/superpowers/specs/2026-07-22-billing-provider-abstraction-design.md). LemonSqueezy behind a provider abstraction; Subscription collection; applier-driven entitlement; free|paid|expert.

Closes #13

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-review notes

- **Spec coverage:** entitlement (T1), Subscription model (T2/T3), provider interface + events (T4), LS impl incl. checkout correlation / signature / variant→tier (T5), applier incl. cancelled-keeps-access + past_due dunning + idempotency + lookup-miss (T6), routes incl. public webhook + raw-body verify + 402-adjacent gating (T7), frontend incl. webhook-driven activation poll (T8), config/secrets API-Lambda-only + preflight (T9), promo codes = native LS (no code, documented). All covered.
- **Type consistency:** `upsertFromEvent`/`updateFromEvent` signatures, `BillingEvent` variants, `getBillingProvider`, `applyBillingEvent`, `PaidTier`/`SubscriptionStatus`, `variantByTier` are used identically across tasks.
- **`hasExpert`** is introduced as the expert-only gate primitive (tested in T1) but intentionally not yet consumed — the expert extra-features/human-operator workflow is out of scope per the spec.
