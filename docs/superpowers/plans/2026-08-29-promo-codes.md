# Promo Codes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promo codes backed by LemonSqueezy discounts — internal free-forever, external time-limited discounts, and affiliate attribution — per `docs/superpowers/specs/2026-08-29-promo-codes-design.md`.

**Architecture:** Every code is a real LS discount created via their API (`percent` × `once|repeating|forever`). A local `promo_codes` doc handles validation/attribution; `promo_redemptions` rows go pending at checkout and confirm on the subscription webhook. Entitlement always flows through the existing `applyBillingEvent` path — no new plan writer. Admin panel mints/deactivates codes; the customer `/billing` page applies them.

**Tech Stack:** TypeScript monorepo — Hono `OpenAPIHono` + zod 4 (`@hono/zod-openapi`), mongodb 7 driver repos, Vitest 4, Next 16 web app, Vite/React admin SPA, Biome.

## Global Constraints

- `import type` for type-only imports; `export type` for type re-exports (`verbatimModuleSyntax`).
- `OpenAPIHono` + chained `.openapi(...)` for every route — never plain `Hono`. API zod schemas get `.openapi('Name')`.
- Repos own `_id` ↔ `id` mapping and `parse` through Zod; app code never touches the driver.
- Biome: single quotes, 2-space indent, 100-char width. Run `npm run lint:fix` after writing code.
- Verification before any "done" claim: `npm run lint && npm run check:all && npm test`. Integration tests additionally need `docker compose up -d mongo` then `npm run test:integration`.
- Commit style: `feat(scope): ...` / `test(scope): ...`, ending with the Claude co-author trailer used in this repo.
- Zod 4 / TS 6 / mongodb 7 / Next 16 — don't trust older API memories; copy patterns from the referenced existing files.
- Work happens on the current branch `claude/seopotion-promo-codes-cc43f6`; PR targets `dev`.

---

### Task 1: Shared promo schemas

**Files:**
- Create: `packages/shared/schemas/src/promo-code.ts`
- Create: `packages/shared/schemas/src/promo-redemption.ts`
- Modify: `packages/shared/schemas/src/index.ts` (add two `export *` lines, alphabetical)
- Test: `packages/shared/schemas/tests/promo-code.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by every later task): `PROMO_DURATIONS`, `PromoDuration`, `PromoCodeSchema`, `PromoCode`, `CreatePromoCodeInput` (type + schema), `PROMO_REDEMPTION_STATUSES`, `PromoRedemptionSchema`, `PromoRedemption` — all exported from `@shared/schemas`.

- [ ] **Step 1: Write the failing test**

`packages/shared/schemas/tests/promo-code.test.ts` (model: `packages/shared/schemas/tests/subscription.test.ts` style):

```ts
import { describe, expect, test } from 'vitest';
import { PromoCodeSchema, PromoRedemptionSchema } from '../src';

const base = {
  id: 'a'.repeat(24),
  code: 'LAUNCH30',
  name: 'Launch promo',
  percent: 30,
  duration: 'repeating' as const,
  duration_in_months: 3,
  active: true,
  ls_discount_id: 'disc_1',
  created_at: new Date('2026-08-29T00:00:00Z'),
};

describe('PromoCodeSchema', () => {
  test('accepts a repeating code with months', () => {
    expect(PromoCodeSchema.parse(base).code).toBe('LAUNCH30');
  });

  test('accepts forever/once codes without months, optional fields absent', () => {
    const { duration_in_months: _m, ...rest } = base;
    expect(PromoCodeSchema.parse({ ...rest, duration: 'forever' }).duration).toBe('forever');
    expect(PromoCodeSchema.parse({ ...rest, duration: 'once' }).duration).toBe('once');
  });

  test('rejects repeating without months and non-repeating with months', () => {
    const { duration_in_months: _m, ...rest } = base;
    expect(PromoCodeSchema.safeParse({ ...rest, duration: 'repeating' }).success).toBe(false);
    expect(
      PromoCodeSchema.safeParse({ ...base, duration: 'forever', duration_in_months: 3 }).success,
    ).toBe(false);
  });

  test.each(['launch30', 'AB', 'HAS SPACE', 'HAS-DASH', 'X'.repeat(33)])(
    'rejects malformed code %s',
    (code) => {
      expect(PromoCodeSchema.safeParse({ ...base, code }).success).toBe(false);
    },
  );

  test.each([0, 101, 30.5])('rejects percent %s', (percent) => {
    expect(PromoCodeSchema.safeParse({ ...base, percent }).success).toBe(false);
  });
});

describe('PromoRedemptionSchema', () => {
  test('parses pending and confirmed rows', () => {
    const row = {
      id: 'b'.repeat(24),
      code_id: base.id,
      code: 'LAUNCH30',
      org_id: 'c'.repeat(24),
      status: 'pending' as const,
      created_at: new Date('2026-08-29T00:00:00Z'),
    };
    expect(PromoRedemptionSchema.parse(row).status).toBe('pending');
    expect(
      PromoRedemptionSchema.parse({
        ...row,
        status: 'confirmed',
        confirmed_at: new Date('2026-08-30T00:00:00Z'),
      }).confirmed_at,
    ).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- promo-code`
Expected: FAIL — `PromoCodeSchema` is not exported.

- [ ] **Step 3: Write the schemas**

`packages/shared/schemas/src/promo-code.ts`:

```ts
import { z } from 'zod';

/** How a discount applies over a subscription's life — mirrors LemonSqueezy. */
export const PROMO_DURATIONS = ['once', 'repeating', 'forever'] as const;
export type PromoDuration = (typeof PROMO_DURATIONS)[number];

/** `duration_in_months` is meaningful only for repeating discounts. */
const durationPairing = (p: { duration: PromoDuration; duration_in_months?: number }) =>
  (p.duration === 'repeating') === (p.duration_in_months !== undefined);

const PromoCodeBase = z.object({
  id: z.string(),
  /** Uppercase letters + digits only — the LS discount code constraint, narrowed. */
  code: z.string().regex(/^[A-Z0-9]{3,32}$/),
  name: z.string().min(1),
  /** Percent-off only in v1 (no fixed-amount codes). */
  percent: z.number().int().min(1).max(100),
  duration: z.enum(PROMO_DURATIONS),
  duration_in_months: z.number().int().min(1).optional(),
  /** Unset = unlimited. Mirrored onto the LS discount as the hard backstop. */
  max_redemptions: z.number().int().min(1).optional(),
  expires_at: z.date().optional(),
  /** Kill switch — deactivation also deletes the LS discount (one-way in v1). */
  active: z.boolean(),
  /** Free-text affiliate label for attribution reporting. */
  affiliate: z.string().optional(),
  ls_discount_id: z.string(),
  created_at: z.date(),
});

export const PromoCodeSchema = PromoCodeBase.refine(durationPairing, {
  message: 'duration_in_months is required iff duration is repeating',
});
export type PromoCode = z.infer<typeof PromoCodeSchema>;

/** Input for creating a promo code — the server assigns `id` and stamps `created_at`. */
export const CreatePromoCodeInput = PromoCodeBase.omit({ id: true, created_at: true }).refine(
  durationPairing,
  { message: 'duration_in_months is required iff duration is repeating' },
);
export type CreatePromoCodeInput = z.input<typeof CreatePromoCodeInput>;
```

`packages/shared/schemas/src/promo-redemption.ts`:

```ts
import { z } from 'zod';

/** pending = a checkout was created with the code; confirmed = the subscription activated. */
export const PROMO_REDEMPTION_STATUSES = ['pending', 'confirmed'] as const;
export type PromoRedemptionStatus = (typeof PROMO_REDEMPTION_STATUSES)[number];

/**
 * One org's use of one promo code — the affiliate-attribution record. Unique
 * per (code_id, org_id); only `confirmed` rows count against a code's
 * `max_redemptions`. See the promo-codes design spec §5.
 */
export const PromoRedemptionSchema = z.object({
  id: z.string(),
  code_id: z.string(),
  /** Denormalized code string so reports don't need a join. */
  code: z.string(),
  org_id: z.string(),
  status: z.enum(PROMO_REDEMPTION_STATUSES),
  created_at: z.date(),
  confirmed_at: z.date().optional(),
});
export type PromoRedemption = z.infer<typeof PromoRedemptionSchema>;
```

Add to `packages/shared/schemas/src/index.ts` (alphabetical position):

```ts
export * from './promo-code';
export * from './promo-redemption';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- promo-code`
Expected: PASS (all cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:fix
git add packages/shared/schemas
git commit -m "feat(schemas): promo code + redemption entities"
```

---

### Task 2: Repos and indexes

**Files:**
- Create: `packages/shared/db/src/repositories/promo-code.repo.ts`
- Create: `packages/shared/db/src/repositories/promo-redemption.repo.ts`
- Modify: `packages/shared/db/src/ensure-indexes.ts` (append before closing brace)
- Modify: `packages/shared/db/src/index.ts` (export both repos, alphabetical)
- Test: `packages/shared/db/tests/promo.repo.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 types from `@shared/schemas`.
- Produces (from `@shared/db`):
  - `PromoCodeRepo`: `create(input: CreatePromoCodeInput): Promise<PromoCode>`, `findByCode(code: string): Promise<PromoCode | null>`, `findById(id: string): Promise<PromoCode | null>`, `list(): Promise<PromoCode[]>` (newest first), `deactivate(id: string): Promise<PromoCode | null>`.
  - `PromoRedemptionRepo`: `upsertPending(codeId: string, code: string, orgId: string): Promise<void>`, `confirmPendingByOrg(orgId: string): Promise<number>`, `countConfirmed(codeId: string): Promise<number>`, `findConfirmedByCodeAndOrg(codeId: string, orgId: string): Promise<PromoRedemption | null>`, `listByCode(codeId: string): Promise<PromoRedemption[]>` (newest first).

- [ ] **Step 1: Write the failing integration test**

`packages/shared/db/tests/promo.repo.integration.test.ts` (model: `subscription.repo.integration.test.ts`; `ensureIndexes()` in `beforeAll` because `upsertPending`'s confirmed-row behavior depends on the unique index):

```ts
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { PromoCodeRepo } from '../src/repositories/promo-code.repo';
import { PromoRedemptionRepo } from '../src/repositories/promo-redemption.repo';

const codeInput = (over: Record<string, unknown> = {}) => ({
  code: 'LAUNCH30',
  name: 'Launch promo',
  percent: 30,
  duration: 'repeating' as const,
  duration_in_months: 3,
  active: true,
  ls_discount_id: 'disc_1',
  ...over,
});

describe('Promo repos (integration)', () => {
  beforeAll(async () => {
    await ensureIndexes();
    const db = await getDb();
    await db.collection('promo_codes').deleteMany({});
    await db.collection('promo_redemptions').deleteMany({});
  });
  afterAll(async () => {
    await closeDb();
  });

  test('create + findByCode + duplicate code rejected by the unique index', async () => {
    const created = await PromoCodeRepo.create(codeInput());
    expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    expect((await PromoCodeRepo.findByCode('LAUNCH30'))?.id).toBe(created.id);
    await expect(PromoCodeRepo.create(codeInput({ ls_discount_id: 'disc_2' }))).rejects.toThrow();
  });

  test('list is newest-first; deactivate flips active and keeps the row', async () => {
    const second = await PromoCodeRepo.create(
      codeInput({ code: 'TEAMFREE', percent: 100, duration: 'forever', duration_in_months: undefined }),
    );
    const listed = await PromoCodeRepo.list();
    expect(listed.map((p) => p.code)).toEqual(['TEAMFREE', 'LAUNCH30']);
    const off = await PromoCodeRepo.deactivate(second.id);
    expect(off?.active).toBe(false);
    expect((await PromoCodeRepo.findByCode('TEAMFREE'))?.active).toBe(false);
  });

  test('upsertPending is idempotent per (code, org); confirm flips pending rows only', async () => {
    const promo = await PromoCodeRepo.findByCode('LAUNCH30');
    if (!promo) throw new Error('setup failed');
    await PromoRedemptionRepo.upsertPending(promo.id, promo.code, 'org1');
    await PromoRedemptionRepo.upsertPending(promo.id, promo.code, 'org1'); // abandoned checkout retried
    const db = await getDb();
    expect(await db.collection('promo_redemptions').countDocuments({})).toBe(1);

    expect(await PromoRedemptionRepo.confirmPendingByOrg('org1')).toBe(1);
    expect(await PromoRedemptionRepo.countConfirmed(promo.id)).toBe(1);
    const confirmed = await PromoRedemptionRepo.findConfirmedByCodeAndOrg(promo.id, 'org1');
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.confirmed_at).toBeInstanceOf(Date);

    // A confirmed row must never be demoted back to pending.
    await PromoRedemptionRepo.upsertPending(promo.id, promo.code, 'org1');
    expect((await PromoRedemptionRepo.findConfirmedByCodeAndOrg(promo.id, 'org1'))?.status).toBe(
      'confirmed',
    );
    expect(await db.collection('promo_redemptions').countDocuments({})).toBe(1);
  });

  test('confirmPendingByOrg with nothing pending returns 0; listByCode returns rows', async () => {
    expect(await PromoRedemptionRepo.confirmPendingByOrg('org-none')).toBe(0);
    const promo = await PromoCodeRepo.findByCode('LAUNCH30');
    if (!promo) throw new Error('setup failed');
    expect((await PromoRedemptionRepo.listByCode(promo.id)).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
docker compose up -d mongo
```

Run: `npm run test:integration -- promo.repo`
Expected: FAIL — repo modules don't exist.

- [ ] **Step 3: Implement the repos and indexes**

`packages/shared/db/src/repositories/promo-code.repo.ts`:

```ts
import {
  type CreatePromoCodeInput,
  type PromoCode,
  PromoCodeSchema,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('promo_codes');

function toEntity(doc: WithId<Document>): PromoCode {
  const { _id, ...rest } = doc;
  return PromoCodeSchema.parse({ id: _id.toString(), ...rest });
}

export const PromoCodeRepo = {
  /** Insert a new code. The unique `code` index rejects duplicates (E11000). */
  async create(input: CreatePromoCodeInput): Promise<PromoCode> {
    const doc = { ...CreatePromoCodeInput.parse(input), created_at: new Date() };
    const res = await (await collection()).insertOne(doc);
    return toEntity({ _id: res.insertedId, ...doc });
  },

  /** Exact-match lookup — callers normalize user input to uppercase first. */
  async findByCode(code: string): Promise<PromoCode | null> {
    const doc = await (await collection()).findOne({ code });
    return doc ? toEntity(doc) : null;
  },

  async findById(id: string): Promise<PromoCode | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async list(): Promise<PromoCode[]> {
    const docs = await (await collection()).find({}).sort({ created_at: -1 }).toArray();
    return docs.map(toEntity);
  },

  /** One-way in v1 — the caller deletes the LS discount first (design §2). */
  async deactivate(id: string): Promise<PromoCode | null> {
    if (!ObjectId.isValid(id)) return null;
    const res = await (await collection()).findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { active: false } },
      { returnDocument: 'after' },
    );
    return res ? toEntity(res) : null;
  },
};
```

`packages/shared/db/src/repositories/promo-redemption.repo.ts`:

```ts
import { type PromoRedemption, PromoRedemptionSchema } from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('promo_redemptions');

function toEntity(doc: WithId<Document>): PromoRedemption {
  const { _id, ...rest } = doc;
  return PromoRedemptionSchema.parse({ id: _id.toString(), ...rest });
}

export const PromoRedemptionRepo = {
  /**
   * Record "a checkout was created with this code" — idempotent per
   * (code, org) so an abandoned checkout never burns the code for that org.
   * The `$ne: 'confirmed'` filter + unique index guarantee a confirmed row is
   * never demoted: the upsert then races into E11000, which is a no-op here.
   */
  async upsertPending(codeId: string, code: string, orgId: string): Promise<void> {
    try {
      await (await collection()).updateOne(
        { code_id: codeId, org_id: orgId, status: { $ne: 'confirmed' } },
        {
          $set: { status: 'pending', created_at: new Date() },
          $setOnInsert: { code_id: codeId, code, org_id: orgId },
        },
        { upsert: true },
      );
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err;
    }
  },

  /**
   * Called by the billing applier on subscription_activated: the org's pending
   * redemptions become confirmed. Correlates by org, not by LS discount — the
   * accepted accuracy caveat in the design spec (§5). Returns the count.
   */
  async confirmPendingByOrg(orgId: string): Promise<number> {
    const res = await (await collection()).updateMany(
      { org_id: orgId, status: 'pending' },
      { $set: { status: 'confirmed', confirmed_at: new Date() } },
    );
    return res.modifiedCount;
  },

  /** Confirmed uses only — pending rows never count against max_redemptions. */
  async countConfirmed(codeId: string): Promise<number> {
    return (await collection()).countDocuments({ code_id: codeId, status: 'confirmed' });
  },

  async findConfirmedByCodeAndOrg(codeId: string, orgId: string): Promise<PromoRedemption | null> {
    const doc = await (await collection()).findOne({
      code_id: codeId,
      org_id: orgId,
      status: 'confirmed',
    });
    return doc ? toEntity(doc) : null;
  },

  async listByCode(codeId: string): Promise<PromoRedemption[]> {
    const docs = await (await collection())
      .find({ code_id: codeId })
      .sort({ created_at: -1 })
      .toArray();
    return docs.map(toEntity);
  },
};
```

Append to `ensureIndexes()` in `packages/shared/db/src/ensure-indexes.ts` (before the closing brace):

```ts
  // Promo codes (design spec 2026-08-29): unique code for validation lookups;
  // one redemption row per (code, org) makes upsertPending idempotent and
  // once-per-org enforceable at the database layer.
  await db.collection('promo_codes').createIndex({ code: 1 }, { unique: true });
  await db
    .collection('promo_redemptions')
    .createIndex({ code_id: 1, org_id: 1 }, { unique: true });
  await db.collection('promo_redemptions').createIndex({ org_id: 1 });
```

Add to `packages/shared/db/src/index.ts` (alphabetical):

```ts
export { PromoCodeRepo } from './repositories/promo-code.repo';
export { PromoRedemptionRepo } from './repositories/promo-redemption.repo';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:integration -- promo.repo`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:fix
git add packages/shared/db
git commit -m "feat(db): promo code + redemption repos and indexes"
```

---

### Task 3: Provider layer — LS discounts + checkout discount code

**Files:**
- Modify: `packages/shared/providers/src/billing/types.ts`
- Modify: `packages/shared/providers/src/billing/lemonsqueezy.ts`
- Test: `packages/shared/providers/tests/lemonsqueezy.test.ts` (append describes)

**Interfaces:**
- Consumes: `PromoDuration` from `@shared/schemas`.
- Produces (on `BillingProvider`, all later API tasks depend on these exact shapes):
  - `createCheckout(input: { tier: PaidTier; orgId: string; userEmail: string; discountCode?: string }): Promise<{ url: string }>`
  - `createDiscount(input: { name: string; code: string; percent: number; duration: PromoDuration; durationInMonths?: number; maxRedemptions?: number; expiresAt?: Date }): Promise<{ providerDiscountId: string }>`
  - `deleteDiscount(providerDiscountId: string): Promise<void>` (LS 404 = already gone = success)

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/providers/tests/lemonsqueezy.test.ts` (the file already builds `provider` from `cfg` at the top; these describes mock global `fetch`):

```ts
describe('lemonsqueezy createCheckout (discounts)', () => {
  afterEach(() => vi.restoreAllMocks());

  const okCheckout = () =>
    new Response(JSON.stringify({ data: { attributes: { url: 'https://ls/checkout/x' } } }), {
      status: 201,
    });

  test('always disables the hosted discount field; passes discount_code when given', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okCheckout());
    await provider.createCheckout({
      tier: 'paid',
      orgId: 'o1',
      userEmail: 'a@b.c',
      discountCode: 'LAUNCH30',
    });
    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body));
    expect(body.data.attributes.checkout_options).toEqual({ discount: false });
    expect(body.data.attributes.checkout_data.discount_code).toBe('LAUNCH30');
  });

  test('omits discount_code when no code is applied (field still disabled)', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(okCheckout());
    await provider.createCheckout({ tier: 'paid', orgId: 'o1', userEmail: 'a@b.c' });
    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body));
    expect(body.data.attributes.checkout_options).toEqual({ discount: false });
    expect('discount_code' in body.data.attributes.checkout_data).toBe(false);
  });
});

describe('lemonsqueezy createDiscount / deleteDiscount', () => {
  afterEach(() => vi.restoreAllMocks());

  test('createDiscount maps repeating fields and limits; returns the LS id', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'disc_9' } }), { status: 201 }),
    );
    const res = await provider.createDiscount({
      name: 'Launch promo',
      code: 'LAUNCH30',
      percent: 30,
      duration: 'repeating',
      durationInMonths: 3,
      maxRedemptions: 50,
      expiresAt: new Date('2026-12-31T00:00:00Z'),
    });
    expect(res).toEqual({ providerDiscountId: 'disc_9' });
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.lemonsqueezy.com/v1/discounts');
    const attrs = JSON.parse(String(init?.body)).data.attributes;
    expect(attrs).toEqual({
      name: 'Launch promo',
      code: 'LAUNCH30',
      amount: 30,
      amount_type: 'percent',
      duration: 'repeating',
      duration_in_months: 3,
      is_limited_redemptions: true,
      max_redemptions: 50,
      expires_at: '2026-12-31T00:00:00.000Z',
    });
    expect(JSON.parse(String(init?.body)).data.relationships.store.data.id).toBe(cfg.storeId);
  });

  test('createDiscount forever/unlimited sends no months/limits keys', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ data: { id: 'disc_10' } }), { status: 201 }),
    );
    await provider.createDiscount({
      name: 'Team free',
      code: 'TEAMFREE',
      percent: 100,
      duration: 'forever',
    });
    const attrs = JSON.parse(String(spy.mock.calls[0]?.[1]?.body)).data.attributes;
    expect(attrs).toEqual({
      name: 'Team free',
      code: 'TEAMFREE',
      amount: 100,
      amount_type: 'percent',
      duration: 'forever',
    });
  });

  test('createDiscount throws on a non-2xx response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 422 }));
    await expect(
      provider.createDiscount({ name: 'X', code: 'XXX', percent: 10, duration: 'once' }),
    ).rejects.toThrow(/discount create failed: 422/);
  });

  test('deleteDiscount DELETEs; 404 is success (already gone); 500 throws', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    await provider.deleteDiscount('disc_9');
    expect(String(spy.mock.calls[0]?.[0])).toBe('https://api.lemonsqueezy.com/v1/discounts/disc_9');
    expect(spy.mock.calls[0]?.[1]?.method).toBe('DELETE');
    await provider.deleteDiscount('disc_9'); // 404 -> resolves
    await expect(provider.deleteDiscount('disc_9')).rejects.toThrow(/discount delete failed: 500/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lemonsqueezy`
Expected: FAIL — `createDiscount` is not a function; checkout body assertions fail.

- [ ] **Step 3: Implement**

In `packages/shared/providers/src/billing/types.ts`: change the import line to `import type { PaidTier, PromoDuration, SubscriptionStatus } from '@shared/schemas';` and replace/extend the interface members:

```ts
  /** Create a hosted checkout for a tier; embeds `orgId` for round-trip correlation.
   * The hosted checkout's own discount field is always disabled — codes only
   * enter through our validated flow (promo design spec §5). */
  createCheckout(input: {
    tier: PaidTier;
    orgId: string;
    userEmail: string;
    discountCode?: string;
  }): Promise<{ url: string }>;

  /** Create the provider-side discount backing a promo code. */
  createDiscount(input: {
    name: string;
    code: string;
    percent: number;
    duration: PromoDuration;
    durationInMonths?: number;
    maxRedemptions?: number;
    expiresAt?: Date;
  }): Promise<{ providerDiscountId: string }>;

  /** Delete the provider-side discount (deactivation). Already-deleted is success. */
  deleteDiscount(providerDiscountId: string): Promise<void>;
```

In `packages/shared/providers/src/billing/lemonsqueezy.ts`:

Replace `createCheckout`'s signature/body-attributes with:

```ts
    async createCheckout({ tier, orgId, userEmail, discountCode }) {
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
              checkout_data: {
                email: userEmail,
                custom: { org_id: orgId },
                ...(discountCode ? { discount_code: discountCode } : {}),
              },
              // Codes must pass our validation first — hide LS's own field.
              checkout_options: { discount: false },
              product_options: { redirect_url: cfg.redirectUrl },
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
```

Add two methods (after `cancelSubscription`):

```ts
    async createDiscount({ name, code, percent, duration, durationInMonths, maxRedemptions, expiresAt }) {
      const res = await fetch(`${LS_API}/discounts`, {
        method: 'POST',
        headers: {
          Accept: JSON_API,
          'Content-Type': JSON_API,
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          data: {
            type: 'discounts',
            attributes: {
              name,
              code,
              amount: percent,
              amount_type: 'percent',
              duration,
              ...(duration === 'repeating' ? { duration_in_months: durationInMonths } : {}),
              ...(maxRedemptions
                ? { is_limited_redemptions: true, max_redemptions: maxRedemptions }
                : {}),
              ...(expiresAt ? { expires_at: expiresAt.toISOString() } : {}),
            },
            relationships: { store: { data: { type: 'stores', id: cfg.storeId } } },
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`LemonSqueezy discount create failed: ${res.status} ${await res.text()}`);
      }
      const json = (await res.json()) as { data: { id: string } };
      return { providerDiscountId: json.data.id };
    },

    async deleteDiscount(providerDiscountId) {
      const res = await fetch(`${LS_API}/discounts/${providerDiscountId}`, {
        method: 'DELETE',
        headers: { Accept: JSON_API, Authorization: `Bearer ${cfg.apiKey}` },
      });
      // 404 = already deleted — deactivation must be idempotent.
      if (!res.ok && res.status !== 404) {
        throw new Error(`LemonSqueezy discount delete failed: ${res.status} ${await res.text()}`);
      }
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lemonsqueezy`
Expected: PASS (existing + new describes).

- [ ] **Step 5: Typecheck (interface change ripples), lint, commit**

Run: `npm run check` — expect PASS (`getBillingProvider` builds the real provider; route mocks are untyped objects, so nothing else must change yet).

```bash
npm run lint:fix
git add packages/shared/providers
git commit -m "feat(providers): LS discount create/delete + checkout discount pass-through"
```

---

### Task 4: Customer API — validation lib + `POST /billing/promo/validate`

**Files:**
- Create: `apps/api/src/lib/promo/validate-code.ts`
- Modify: `apps/api/src/schemas/billing.ts`
- Modify: `apps/api/src/routes/billing.ts`
- Test: `apps/api/tests/billing.test.ts` (extend mocks + new describe)

**Interfaces:**
- Consumes: `PromoCodeRepo`, `PromoRedemptionRepo` (Task 2); `PROMO_DURATIONS` (Task 1); existing `loadOwnedOrg`.
- Produces:
  - `validatePromoCode(rawCode: string, orgId: string): Promise<PromoValidation>` where `PromoValidation = { ok: true; promo: PromoCode } | { ok: false; reason: PromoRejectReason }` and `PromoRejectReason = 'not_found' | 'inactive' | 'expired' | 'exhausted' | 'already_redeemed'` (exported `PROMO_REJECT_REASONS` const array lives in `apps/api/src/schemas/billing.ts`).
  - Route `POST /billing/promo/validate` — body `{ org_id, code }`; 200 `{ valid: true, code, percent, duration, duration_in_months? }`; 422 `{ valid: false, reason }`; 403 not owned.

- [ ] **Step 1: Extend the test file's mocks and write failing tests**

In `apps/api/tests/billing.test.ts`, replace the `@shared/db` mock with one that includes the promo repos, and keep handles for assertions:

```ts
const { findLatestByOrg, promoCodeRepo, promoRedemptionRepo } = vi.hoisted(() => ({
  findLatestByOrg: vi.fn(),
  promoCodeRepo: { findByCode: vi.fn() },
  promoRedemptionRepo: {
    upsertPending: vi.fn(),
    countConfirmed: vi.fn(),
    findConfirmedByCodeAndOrg: vi.fn(),
  },
}));
vi.mock('@shared/db', () => ({
  SubscriptionRepo: { findLatestByOrg },
  PromoCodeRepo: promoCodeRepo,
  PromoRedemptionRepo: promoRedemptionRepo,
}));
```

Add a describe (a valid promo fixture + one test per reject reason + the happy path):

```ts
describe('POST /promo/validate', () => {
  const promo = {
    id: 'p'.repeat(24),
    code: 'LAUNCH30',
    name: 'Launch promo',
    percent: 30,
    duration: 'repeating' as const,
    duration_in_months: 3,
    max_redemptions: 50,
    active: true,
    ls_discount_id: 'disc_1',
    created_at: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    loadOwnedOrg.mockResolvedValue({ id: 'o1', user_id: 'u1', plan: 'free' });
    promoRedemptionRepo.findConfirmedByCodeAndOrg.mockResolvedValue(null);
    promoRedemptionRepo.countConfirmed.mockResolvedValue(0);
  });

  test('403 when the org is not owned', async () => {
    loadOwnedOrg.mockResolvedValueOnce(null);
    const res = await testClient(app).promo.validate.$post({
      json: { org_id: 'o1', code: 'LAUNCH30' },
    });
    expect(res.status).toBe(403);
  });

  test('200 with the discount terms; input is trimmed and uppercased', async () => {
    promoCodeRepo.findByCode.mockResolvedValueOnce(promo);
    const res = await testClient(app).promo.validate.$post({
      json: { org_id: 'o1', code: '  launch30 ' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      valid: true,
      code: 'LAUNCH30',
      percent: 30,
      duration: 'repeating',
      duration_in_months: 3,
    });
    expect(promoCodeRepo.findByCode).toHaveBeenCalledWith('LAUNCH30');
  });

  test.each([
    ['not_found', () => promoCodeRepo.findByCode.mockResolvedValueOnce(null)],
    ['inactive', () => promoCodeRepo.findByCode.mockResolvedValueOnce({ ...promo, active: false })],
    [
      'expired',
      () =>
        promoCodeRepo.findByCode.mockResolvedValueOnce({
          ...promo,
          expires_at: new Date(Date.now() - 1000),
        }),
    ],
    [
      'already_redeemed',
      () => {
        promoCodeRepo.findByCode.mockResolvedValueOnce(promo);
        promoRedemptionRepo.findConfirmedByCodeAndOrg.mockResolvedValueOnce({ id: 'r1' });
      },
    ],
    [
      'exhausted',
      () => {
        promoCodeRepo.findByCode.mockResolvedValueOnce(promo);
        promoRedemptionRepo.countConfirmed.mockResolvedValueOnce(50);
      },
    ],
  ])('422 %s', async (reason, arrange) => {
    arrange();
    const res = await testClient(app).promo.validate.$post({
      json: { org_id: 'o1', code: 'LAUNCH30' },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ valid: false, reason });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- billing.test`
Expected: new describe FAILS (`promo` route missing); pre-existing tests still PASS.

- [ ] **Step 3: Implement**

`apps/api/src/lib/promo/validate-code.ts`:

```ts
import { PromoCodeRepo, PromoRedemptionRepo } from '@shared/db';
import type { PromoCode } from '@shared/schemas';
import type { PromoRejectReason } from '../../schemas/billing';

export type PromoValidation =
  | { ok: true; promo: PromoCode }
  | { ok: false; reason: PromoRejectReason };

/**
 * The UX gate for promo codes — checked at apply time and re-checked at
 * checkout. The mirrored LS max_redemptions/expires_at are the hard backstop
 * against races (design spec §5), so a small TOCTOU window here is fine.
 */
export async function validatePromoCode(rawCode: string, orgId: string): Promise<PromoValidation> {
  const code = rawCode.trim().toUpperCase();
  const promo = await PromoCodeRepo.findByCode(code);
  if (!promo) return { ok: false, reason: 'not_found' };
  if (!promo.active) return { ok: false, reason: 'inactive' };
  if (promo.expires_at && promo.expires_at.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (await PromoRedemptionRepo.findConfirmedByCodeAndOrg(promo.id, orgId)) {
    return { ok: false, reason: 'already_redeemed' };
  }
  if (
    promo.max_redemptions !== undefined &&
    (await PromoRedemptionRepo.countConfirmed(promo.id)) >= promo.max_redemptions
  ) {
    return { ok: false, reason: 'exhausted' };
  }
  return { ok: true, promo };
}
```

Append to `apps/api/src/schemas/billing.ts` (also add `import { PAID_TIERS, PROMO_DURATIONS } from '@shared/schemas';` to the existing import):

```ts
export const PROMO_REJECT_REASONS = [
  'not_found',
  'inactive',
  'expired',
  'exhausted',
  'already_redeemed',
] as const;
export type PromoRejectReason = (typeof PROMO_REJECT_REASONS)[number];

export const PromoValidateBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    code: z.string().trim().min(1).max(64).openapi({ example: 'LAUNCH30' }),
  })
  .openapi('PromoValidateBody');

export const PromoValidateResponse = z
  .object({
    valid: z.literal(true),
    code: z.string(),
    percent: z.number().int(),
    duration: z.enum(PROMO_DURATIONS),
    duration_in_months: z.number().int().optional(),
  })
  .openapi('PromoValidateResponse');

export const PromoInvalidResponse = z
  .object({ valid: z.literal(false), reason: z.enum(PROMO_REJECT_REASONS) })
  .openapi('PromoInvalidResponse');
```

Chain onto the router in `apps/api/src/routes/billing.ts` (after the `/portal` route, before the webhook; add `import { validatePromoCode } from '../lib/promo/validate-code';`):

```ts
  .openapi(
    createRoute({
      tags: ['billing'],
      method: 'post',
      path: '/promo/validate',
      summary: 'Validate a promo code for an org (pre-checkout)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.PromoValidateBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.PromoValidateResponse } },
          description: 'The code is applicable; discount terms for display',
        },
        403: { description: 'Org not found or not owned by the caller' },
        422: {
          content: { 'application/json': { schema: schemas.PromoInvalidResponse } },
          description: 'Code rejected (see reason)',
        },
      },
    }),
    async (c) => {
      const { org_id, code } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
      const result = await validatePromoCode(code, org.id);
      if (!result.ok) return c.json({ valid: false as const, reason: result.reason }, 422);
      const { promo } = result;
      return c.json(
        {
          valid: true as const,
          code: promo.code,
          percent: promo.percent,
          duration: promo.duration,
          duration_in_months: promo.duration_in_months,
        },
        200,
      );
    },
  )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- billing.test`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:fix
git add apps/api
git commit -m "feat(api): promo code validation route"
```

---

### Task 5: Customer API — checkout with promo + webhook confirmation

**Files:**
- Modify: `apps/api/src/schemas/billing.ts` (extend `CheckoutBody`, add error schema)
- Modify: `apps/api/src/routes/billing.ts` (checkout handler)
- Modify: `apps/api/src/lib/billing/apply-event.ts`
- Test: `apps/api/tests/billing.test.ts`, `apps/api/tests/apply-billing-event.test.ts`

**Interfaces:**
- Consumes: `validatePromoCode` (Task 4), `PromoRedemptionRepo.upsertPending` / `.confirmPendingByOrg` (Task 2), provider `discountCode` (Task 3).
- Produces: `CheckoutBody` gains optional `promo_code: string`; checkout 422 body `{ error: 'invalid_promo', reason: PromoRejectReason }` (schema `CheckoutPromoErrorResponse`). Web (Task 8) depends on these names.

- [ ] **Step 1: Write failing tests**

Append to the `POST /checkout` describe in `apps/api/tests/billing.test.ts`:

```ts
  test('422 invalid_promo when the code fails validation; no checkout created', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'free' });
    promoCodeRepo.findByCode.mockResolvedValueOnce(null);
    const res = await testClient(app).checkout.$post({
      json: { org_id: 'o1', tier: 'paid', promo_code: 'NOPE' },
    });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: 'invalid_promo', reason: 'not_found' });
    expect(createCheckout).not.toHaveBeenCalled();
    expect(promoRedemptionRepo.upsertPending).not.toHaveBeenCalled();
  });

  test('200 with a valid promo: passes discountCode and records a pending redemption', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'free' });
    promoCodeRepo.findByCode.mockResolvedValueOnce({
      id: 'p'.repeat(24),
      code: 'LAUNCH30',
      name: 'Launch promo',
      percent: 30,
      duration: 'repeating',
      duration_in_months: 3,
      active: true,
      ls_discount_id: 'disc_1',
      created_at: new Date(),
    });
    promoRedemptionRepo.findConfirmedByCodeAndOrg.mockResolvedValueOnce(null);
    createCheckout.mockResolvedValueOnce({ url: 'https://ls/checkout/promo' });
    const res = await testClient(app).checkout.$post({
      json: { org_id: 'o1', tier: 'paid', promo_code: 'launch30' },
    });
    expect(res.status).toBe(200);
    expect(createCheckout).toHaveBeenCalledWith({
      tier: 'paid',
      orgId: 'o1',
      userEmail: 'u1@example.com',
      discountCode: 'LAUNCH30',
    });
    expect(promoRedemptionRepo.upsertPending).toHaveBeenCalledWith('p'.repeat(24), 'LAUNCH30', 'o1');
  });

  test('checkout without a promo neither validates nor records anything', async () => {
    loadOwnedOrg.mockResolvedValueOnce({ id: 'o1', user_id: 'u1', plan: 'free' });
    createCheckout.mockResolvedValueOnce({ url: 'https://ls/checkout/abc' });
    const res = await testClient(app).checkout.$post({ json: { org_id: 'o1', tier: 'paid' } });
    expect(res.status).toBe(200);
    expect(promoCodeRepo.findByCode).not.toHaveBeenCalled();
    expect(promoRedemptionRepo.upsertPending).not.toHaveBeenCalled();
  });
```

In `apps/api/tests/apply-billing-event.test.ts`: add `PromoRedemptionRepo: { confirmPendingByOrg: vi.fn() }` to the file's hoisted `vi.mock('@shared/db', ...)` factory (keep a handle like the other repos in that file), then append:

```ts
  test('activation confirms the org’s pending promo redemptions', async () => {
    // Arrange the same happy-path activation fixture already used in this file.
    await applyBillingEvent(activatedEvent, provider);
    expect(repos.PromoRedemptionRepo.confirmPendingByOrg).toHaveBeenCalledWith(activatedEvent.orgId);
  });

  test('a redemption-confirm failure never fails the webhook (entitlement already applied)', async () => {
    repos.PromoRedemptionRepo.confirmPendingByOrg.mockRejectedValueOnce(new Error('mongo down'));
    await expect(applyBillingEvent(activatedEvent, provider)).resolves.toBeUndefined();
  });
```

(Adapt fixture/handle names to the file's existing `vi.hoisted` structure — assert against whatever the activation-event fixture is called there; add a minimal one only if none exists.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- billing.test` and `npm test -- apply-billing-event`
Expected: new tests FAIL (`promo_code` rejected by schema / `confirmPendingByOrg` never called).

- [ ] **Step 3: Implement**

In `apps/api/src/schemas/billing.ts`, extend `CheckoutBody` and add:

```ts
export const CheckoutBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    tier: z.enum(PAID_TIERS).openapi({ example: 'paid' }),
    /** Already-validated promo code; re-validated server-side at checkout. */
    promo_code: z.string().trim().min(1).max(64).optional().openapi({ example: 'LAUNCH30' }),
  })
  .openapi('CheckoutBody');

export const CheckoutPromoErrorResponse = z
  .object({ error: z.literal('invalid_promo'), reason: z.enum(PROMO_REJECT_REASONS) })
  .openapi('CheckoutPromoErrorResponse');
```

In `apps/api/src/routes/billing.ts` checkout route: add to `responses`:

```ts
        422: {
          content: { 'application/json': { schema: schemas.CheckoutPromoErrorResponse } },
          description: 'The promo code failed validation',
        },
```

and replace the handler body with (imports: `PromoRedemptionRepo` joins the existing `@shared/db` import; `import type { PromoCode } from '@shared/schemas';`):

```ts
    async (c) => {
      const { org_id, tier, promo_code } = c.req.valid('json');
      const { userId, email } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
      // Already entitled at an equal-or-higher tier -> send them to the portal instead.
      if (isPaid(org) && planRank(org.plan) >= planRank(tier)) return c.body(null, 409);
      // Re-validate at checkout time — the code may have died since apply.
      let promo: PromoCode | undefined;
      if (promo_code) {
        const result = await validatePromoCode(promo_code, org.id);
        if (!result.ok) {
          return c.json({ error: 'invalid_promo' as const, reason: result.reason }, 422);
        }
        promo = result.promo;
      }
      const provider = await getBillingProvider();
      const { url } = await provider.createCheckout({
        tier,
        orgId: org.id,
        userEmail: email,
        discountCode: promo?.code,
      });
      // Pending until the subscription webhook confirms; idempotent per (code, org).
      if (promo) await PromoRedemptionRepo.upsertPending(promo.id, promo.code, org.id);
      return c.json({ url }, 200);
    },
```

In `apps/api/src/lib/billing/apply-event.ts`, add `PromoRedemptionRepo` to the `@shared/db` import and insert directly after the `OrgRepo.setPlan(event.orgId, event.tier)` line in the `subscription_activated` case:

```ts
      // Attribution only — must never fail entitlement. Correlates by org (the
      // accepted caveat in the promo design spec §5).
      try {
        await PromoRedemptionRepo.confirmPendingByOrg(event.orgId);
      } catch (err) {
        logger.warn('promo redemption confirm failed', {
          org_id: event.orgId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- billing.test` and `npm test -- apply-billing-event`
Expected: PASS, including all pre-existing tests (the vitest `toHaveBeenCalledWith` ignores the now-present `discountCode: undefined` in old assertions).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint:fix
git add apps/api
git commit -m "feat(api): promo-aware checkout + webhook redemption confirmation"
```

---

### Task 6: Admin API — mint, list, deactivate, redemptions

**Files:**
- Modify: `packages/shared/schemas/src/admin-action.ts` (`org_id` nullable)
- Modify: `apps/api/src/admin/audit.ts` (action names; `org_id` optional)
- Modify: `apps/api/src/admin/schemas.ts` (promo schemas)
- Modify: `apps/api/src/admin/dto.ts` (promo DTOs)
- Create: `apps/api/src/admin/routes/promo-codes.ts`
- Modify: `apps/api/src/admin/index.ts` (mount)
- Modify: every existing admin test whose `vi.mock('@shared/db', ...)` factory backs `adminApp` (find them: `grep -l "vi.mock('@shared/db'" apps/api/tests/admin.*.test.ts`) — add `PromoCodeRepo: {}, PromoRedemptionRepo: {}` stubs so the new route file's imports resolve.
- Test: `apps/api/tests/admin.promo-codes.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 exports; existing `audit`, `getBillingProvider`, `adminAuthMiddleware` wiring.
- Produces (admin SPA Task 7 depends on these):
  - `POST /admin/v0/promo-codes` → 201 `{ promo_code: AdminPromoCode }`, 409 `{ error: 'code_exists' }`
  - `GET /admin/v0/promo-codes` → 200 `{ promo_codes: AdminPromoCode[] }`
  - `GET /admin/v0/promo-codes/{promo_code_id}/redemptions` → 200 `{ redemptions: AdminPromoRedemption[] }`, 404
  - `POST /admin/v0/promo-codes/{promo_code_id}/deactivate` → 200 `{ promo_code: AdminPromoCode }`, 404, 409 `{ error: 'already_inactive' }`
  - `AdminPromoCode` = `{ id, code, name, percent, duration, duration_in_months: number|null, max_redemptions: number|null, expires_at: string|null, active, affiliate: string|null, ls_discount_id, confirmed_redemptions, created_at }` (dates ISO strings).
  - New audit actions `'promo_code.create' | 'promo_code.deactivate'` with `org_id: null`.

- [ ] **Step 1: Widen the audit path (small, mechanical — no test first)**

In `packages/shared/schemas/src/admin-action.ts`: change `org_id: z.string(),` to `org_id: z.string().nullable(),` and extend the doc comment with `// null for org-independent actions (promo codes).`

In `apps/api/src/admin/audit.ts`: add `| 'promo_code.create' | 'promo_code.deactivate'` to `AdminActionName`; change the input field to `org_id?: string;` and the insert line to `org_id: input.org_id ?? null,`.

Run: `npm run check` — expect PASS (callers pass strings; nullable widens).

- [ ] **Step 2: Write the failing route tests**

`apps/api/tests/admin.promo-codes.test.ts` (model: `apps/api/tests/admin.plan.test.ts` — same `signAdminToken` auth helper and wholesale `@shared/db` mock; this file's factory must include ALL repos the admin app's import graph pulls in — copy the factory from `admin.plan.test.ts` and add the promo repos):

```ts
import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  OrgRepo: { findById: vi.fn(), search: vi.fn(), findByUserId: vi.fn(), setPlan: vi.fn(), claimStrategy: vi.fn(), setStrategyStatus: vi.fn() },
  UserRepo: { findById: vi.fn(), findByEmail: vi.fn() },
  SubscriptionRepo: { findLatestByOrg: vi.fn(), listActiveByOrg: vi.fn() },
  GscConnectionRepo: { findByOrgId: vi.fn() },
  KeywordRepo: { countScheduled: vi.fn() },
  ArticleRepo: { countByStatus: vi.fn() },
  AdminActionRepo: { insert: vi.fn() },
  PromoCodeRepo: { create: vi.fn(), findByCode: vi.fn(), findById: vi.fn(), list: vi.fn(), deactivate: vi.fn() },
  PromoRedemptionRepo: { countConfirmed: vi.fn(), listByCode: vi.fn() },
}));
vi.mock('@shared/db', () => repos);

const { enqueueScanTask } = vi.hoisted(() => ({ enqueueScanTask: vi.fn() }));
vi.mock('../src/clients/sqs', () => ({ enqueueScanTask }));
const { launchStrategy } = vi.hoisted(() => ({ launchStrategy: vi.fn() }));
vi.mock('@shared/strategy', () => ({ launchStrategy }));

const { createDiscount, deleteDiscount } = vi.hoisted(() => ({
  createDiscount: vi.fn(),
  deleteDiscount: vi.fn(),
}));
vi.mock('../src/clients/billing', () => ({
  getBillingProvider: async () => ({ name: 'lemonsqueezy', createDiscount, deleteDiscount }),
}));

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';

const client = testClient<AdminAppType>(adminApp);
const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
});

const promo = {
  id: 'p'.repeat(24),
  code: 'LAUNCH30',
  name: 'Launch promo',
  percent: 30,
  duration: 'repeating' as const,
  duration_in_months: 3,
  max_redemptions: 50,
  active: true,
  affiliate: 'jane',
  ls_discount_id: 'disc_1',
  created_at: new Date('2026-08-29T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  repos.AdminActionRepo.insert.mockResolvedValue({});
  repos.PromoRedemptionRepo.countConfirmed.mockResolvedValue(0);
});

describe('POST /admin/v0/promo-codes', () => {
  const body = {
    code: 'LAUNCH30',
    name: 'Launch promo',
    percent: 30,
    duration: 'repeating' as const,
    duration_in_months: 3,
    max_redemptions: 50,
    affiliate: 'jane',
  };

  test('creates the LS discount first, then the local doc; audits with org_id null', async () => {
    repos.PromoCodeRepo.findByCode.mockResolvedValueOnce(null);
    createDiscount.mockResolvedValueOnce({ providerDiscountId: 'disc_1' });
    repos.PromoCodeRepo.create.mockResolvedValueOnce(promo);

    const res = await client.admin.v0['promo-codes'].$post({ json: body }, await authed());
    expect(res.status).toBe(201);
    expect((await res.json()).promo_code).toMatchObject({
      code: 'LAUNCH30',
      confirmed_redemptions: 0,
      created_at: '2026-08-29T00:00:00.000Z',
    });
    expect(createDiscount).toHaveBeenCalledWith({
      name: 'Launch promo',
      code: 'LAUNCH30',
      percent: 30,
      duration: 'repeating',
      durationInMonths: 3,
      maxRedemptions: 50,
      expiresAt: undefined,
    });
    expect(repos.PromoCodeRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ ls_discount_id: 'disc_1', active: true, affiliate: 'jane' }),
    );
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'promo_code.create',
        org_id: null,
        entity: { type: 'promo_code', id: promo.id },
      }),
    );
  });

  test('generates a code when none is given', async () => {
    repos.PromoCodeRepo.findByCode.mockResolvedValueOnce(null);
    createDiscount.mockResolvedValueOnce({ providerDiscountId: 'disc_1' });
    repos.PromoCodeRepo.create.mockImplementationOnce(async (input) => ({ ...promo, ...input, id: promo.id, created_at: promo.created_at }));

    const { code: _c, ...noCode } = body;
    const res = await client.admin.v0['promo-codes'].$post({ json: noCode }, await authed());
    expect(res.status).toBe(201);
    const created = createDiscount.mock.calls[0]?.[0].code as string;
    expect(created).toMatch(/^[A-Z0-9]{8}$/);
  });

  test('409 code_exists before touching LS', async () => {
    repos.PromoCodeRepo.findByCode.mockResolvedValueOnce(promo);
    const res = await client.admin.v0['promo-codes'].$post({ json: body }, await authed());
    expect(res.status).toBe(409);
    expect(createDiscount).not.toHaveBeenCalled();
  });

  test('local insert failure best-effort deletes the LS discount and 500s (no audit)', async () => {
    repos.PromoCodeRepo.findByCode.mockResolvedValueOnce(null);
    createDiscount.mockResolvedValueOnce({ providerDiscountId: 'disc_1' });
    repos.PromoCodeRepo.create.mockRejectedValueOnce(new Error('mongo down'));

    const res = await client.admin.v0['promo-codes'].$post({ json: body }, await authed());
    expect(res.status).toBe(500);
    expect(deleteDiscount).toHaveBeenCalledWith('disc_1');
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('400 when duration_in_months is missing for repeating (zod refine, no defaultHook)', async () => {
    const { duration_in_months: _m, ...bad } = body;
    const res = await client.admin.v0['promo-codes'].$post({ json: bad }, await authed());
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/v0/promo-codes', () => {
  test('lists codes with confirmed redemption counts', async () => {
    repos.PromoCodeRepo.list.mockResolvedValueOnce([promo]);
    repos.PromoRedemptionRepo.countConfirmed.mockResolvedValueOnce(7);
    const res = await client.admin.v0['promo-codes'].$get(undefined, await authed());
    expect(res.status).toBe(200);
    expect((await res.json()).promo_codes[0]).toMatchObject({
      code: 'LAUNCH30',
      confirmed_redemptions: 7,
      affiliate: 'jane',
    });
  });
});

describe('GET /admin/v0/promo-codes/{id}/redemptions', () => {
  test('404 unknown code; 200 lists rows', async () => {
    repos.PromoCodeRepo.findById.mockResolvedValueOnce(null);
    const missing = await client.admin.v0['promo-codes'][':promo_code_id'].redemptions.$get(
      { param: { promo_code_id: 'x'.repeat(24) } },
      await authed(),
    );
    expect(missing.status).toBe(404);

    repos.PromoCodeRepo.findById.mockResolvedValueOnce(promo);
    repos.PromoRedemptionRepo.listByCode.mockResolvedValueOnce([
      {
        id: 'r'.repeat(24),
        code_id: promo.id,
        code: promo.code,
        org_id: 'o'.repeat(24),
        status: 'confirmed',
        created_at: new Date('2026-08-29T01:00:00.000Z'),
        confirmed_at: new Date('2026-08-29T02:00:00.000Z'),
      },
    ]);
    const res = await client.admin.v0['promo-codes'][':promo_code_id'].redemptions.$get(
      { param: { promo_code_id: promo.id } },
      await authed(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).redemptions[0]).toMatchObject({
      org_id: 'o'.repeat(24),
      status: 'confirmed',
      confirmed_at: '2026-08-29T02:00:00.000Z',
    });
  });
});

describe('POST /admin/v0/promo-codes/{id}/deactivate', () => {
  test('deletes the LS discount, flips active, audits with a before snapshot', async () => {
    repos.PromoCodeRepo.findById.mockResolvedValueOnce(promo);
    repos.PromoCodeRepo.deactivate.mockResolvedValueOnce({ ...promo, active: false });
    const res = await client.admin.v0['promo-codes'][':promo_code_id'].deactivate.$post(
      { param: { promo_code_id: promo.id } },
      await authed(),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).promo_code.active).toBe(false);
    expect(deleteDiscount).toHaveBeenCalledWith('disc_1');
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'promo_code.deactivate', before: promo }),
    );
  });

  test('404 unknown; 409 already inactive (no LS call, no audit)', async () => {
    repos.PromoCodeRepo.findById.mockResolvedValueOnce(null);
    const missing = await client.admin.v0['promo-codes'][':promo_code_id'].deactivate.$post(
      { param: { promo_code_id: 'x'.repeat(24) } },
      await authed(),
    );
    expect(missing.status).toBe(404);

    repos.PromoCodeRepo.findById.mockResolvedValueOnce({ ...promo, active: false });
    const res = await client.admin.v0['promo-codes'][':promo_code_id'].deactivate.$post(
      { param: { promo_code_id: promo.id } },
      await authed(),
    );
    expect(res.status).toBe(409);
    expect(deleteDiscount).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- admin.promo-codes`
Expected: FAIL — route module doesn't exist.

- [ ] **Step 4: Implement schemas, DTOs, routes, mount**

Append to `apps/api/src/admin/schemas.ts` (add `PROMO_DURATIONS, PROMO_REDEMPTION_STATUSES` to the `@shared/schemas` import):

```ts
// --- Promo codes (design spec 2026-08-29) ---

export const AdminPromoCodeParams = z.object({ promo_code_id: z.string() });

export const AdminPromoCodeCreateBody = z
  .object({
    /** Omit to have the server generate a random 8-char code. */
    code: z.string().regex(/^[A-Z0-9]{3,32}$/).optional(),
    name: z.string().trim().min(1).max(200),
    percent: z.number().int().min(1).max(100),
    /** repeating counts months against billing cycles: a 3-month code on a
     * yearly checkout discounts the whole first yearly payment (spec §2). */
    duration: z.enum(PROMO_DURATIONS),
    duration_in_months: z.number().int().min(1).max(120).optional(),
    max_redemptions: z.number().int().min(1).optional(),
    expires_at: z.coerce.date().optional(),
    affiliate: z.string().trim().min(1).max(200).optional(),
  })
  .refine((b) => (b.duration === 'repeating') === (b.duration_in_months !== undefined), {
    message: 'duration_in_months is required iff duration is repeating',
  })
  .openapi('AdminPromoCodeCreateBody');

const AdminPromoCode = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    percent: z.number().int(),
    duration: z.enum(PROMO_DURATIONS),
    duration_in_months: z.number().int().nullable(),
    max_redemptions: z.number().int().nullable(),
    expires_at: z.string().nullable(),
    active: z.boolean(),
    affiliate: z.string().nullable(),
    ls_discount_id: z.string(),
    confirmed_redemptions: z.number().int(),
    created_at: z.string(),
  })
  .openapi('AdminPromoCode');

export const AdminPromoCodeResponse = z
  .object({ promo_code: AdminPromoCode })
  .openapi('AdminPromoCodeResponse');

export const AdminPromoCodesResponse = z
  .object({ promo_codes: z.array(AdminPromoCode) })
  .openapi('AdminPromoCodesResponse');

const AdminPromoRedemption = z
  .object({
    id: z.string(),
    org_id: z.string(),
    status: z.enum(PROMO_REDEMPTION_STATUSES),
    created_at: z.string(),
    confirmed_at: z.string().nullable(),
  })
  .openapi('AdminPromoRedemption');

export const AdminPromoRedemptionsResponse = z
  .object({ redemptions: z.array(AdminPromoRedemption) })
  .openapi('AdminPromoRedemptionsResponse');
```

Append to `apps/api/src/admin/dto.ts` (add `PromoCode, PromoRedemption` to the type import):

```ts
export function toAdminPromoCode(
  promo: PromoCode,
  confirmedRedemptions: number,
): z.infer<typeof schemas.AdminPromoCodeResponse>['promo_code'] {
  return {
    id: promo.id,
    code: promo.code,
    name: promo.name,
    percent: promo.percent,
    duration: promo.duration,
    duration_in_months: promo.duration_in_months ?? null,
    max_redemptions: promo.max_redemptions ?? null,
    expires_at: promo.expires_at?.toISOString() ?? null,
    active: promo.active,
    affiliate: promo.affiliate ?? null,
    ls_discount_id: promo.ls_discount_id,
    confirmed_redemptions: confirmedRedemptions,
    created_at: promo.created_at.toISOString(),
  };
}

export function toAdminPromoRedemption(
  row: PromoRedemption,
): z.infer<typeof schemas.AdminPromoRedemptionsResponse>['redemptions'][number] {
  return {
    id: row.id,
    org_id: row.org_id,
    status: row.status,
    created_at: row.created_at.toISOString(),
    confirmed_at: row.confirmed_at?.toISOString() ?? null,
  };
}
```

Create `apps/api/src/admin/routes/promo-codes.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { PromoCodeRepo, PromoRedemptionRepo } from '@shared/db';
import { getBillingProvider } from '../../clients/billing';
import { audit } from '../audit';
import { toAdminPromoCode, toAdminPromoRedemption } from '../dto';
import type { AdminEnv } from '../middleware';
import * as schemas from '../schemas';

/** No ambiguous glyphs (I/L/O/0/1) — codes get read aloud and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  return Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * Promo code management (design spec 2026-08-29). Every code is backed by a
 * real LS discount: create LS-first (an orphan LS discount is harmless and
 * best-effort cleaned; a local doc without its LS discount would validate but
 * never apply). Not org-scoped, so audit rows carry org_id null.
 */
const promoCodes = new OpenAPIHono<AdminEnv>()
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/promo-codes',
      summary: 'Mint a promo code (creates the backing LS discount)',
      security: [{ Bearer: [] }],
      request: {
        body: {
          content: { 'application/json': { schema: schemas.AdminPromoCodeCreateBody } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { 'application/json': { schema: schemas.AdminPromoCodeResponse } },
          description: 'Code created here and at LemonSqueezy',
        },
        401: { description: 'Missing or invalid admin token' },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'code_exists',
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const code = body.code ?? generateCode();
      if (await PromoCodeRepo.findByCode(code)) return c.json({ error: 'code_exists' }, 409);

      const provider = await getBillingProvider();
      const { providerDiscountId } = await provider.createDiscount({
        name: body.name,
        code,
        percent: body.percent,
        duration: body.duration,
        durationInMonths: body.duration_in_months,
        maxRedemptions: body.max_redemptions,
        expiresAt: body.expires_at,
      });

      let promo: Awaited<ReturnType<typeof PromoCodeRepo.create>>;
      try {
        promo = await PromoCodeRepo.create({
          code,
          name: body.name,
          percent: body.percent,
          duration: body.duration,
          duration_in_months: body.duration_in_months,
          max_redemptions: body.max_redemptions,
          expires_at: body.expires_at,
          active: true,
          affiliate: body.affiliate,
          ls_discount_id: providerDiscountId,
        });
      } catch (err) {
        // Don't leave a redeemable LS discount our validation knows nothing about.
        await provider.deleteDiscount(providerDiscountId).catch(() => {});
        throw err;
      }

      await audit(c, {
        action: 'promo_code.create',
        entity: { type: 'promo_code', id: promo.id },
        payload: { ...body, code },
      });
      return c.json({ promo_code: toAdminPromoCode(promo, 0) }, 201);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/promo-codes',
      summary: 'All promo codes with confirmed redemption counts',
      security: [{ Bearer: [] }],
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPromoCodesResponse } },
          description: 'Codes, newest first',
        },
        401: { description: 'Missing or invalid admin token' },
      },
    }),
    async (c) => {
      const codes = await PromoCodeRepo.list();
      const counts = await Promise.all(codes.map((p) => PromoRedemptionRepo.countConfirmed(p.id)));
      return c.json({ promo_codes: codes.map((p, i) => toAdminPromoCode(p, counts[i] ?? 0)) }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/promo-codes/{promo_code_id}/redemptions',
      summary: "A code's redemptions (the affiliate attribution report)",
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminPromoCodeParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPromoRedemptionsResponse } },
          description: 'Redemption rows, newest first',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Promo code not found',
        },
      },
    }),
    async (c) => {
      const { promo_code_id } = c.req.valid('param');
      const promo = await PromoCodeRepo.findById(promo_code_id);
      if (!promo) return c.json({ error: 'not_found' }, 404);
      const redemptions = await PromoRedemptionRepo.listByCode(promo.id);
      return c.json({ redemptions: redemptions.map(toAdminPromoRedemption) }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/promo-codes/{promo_code_id}/deactivate',
      summary: 'Kill switch — deletes the LS discount; one-way in v1',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminPromoCodeParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPromoCodeResponse } },
          description: 'Code deactivated (redemption history kept)',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Promo code not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'already_inactive',
        },
      },
    }),
    async (c) => {
      const { promo_code_id } = c.req.valid('param');
      const promo = await PromoCodeRepo.findById(promo_code_id);
      if (!promo) return c.json({ error: 'not_found' }, 404);
      if (!promo.active) return c.json({ error: 'already_inactive' }, 409);

      // LS first: if the delete fails we 500 with the code still fully active
      // on both sides — never locally-dead but still redeemable at LS.
      const provider = await getBillingProvider();
      await provider.deleteDiscount(promo.ls_discount_id);
      const updated = (await PromoCodeRepo.deactivate(promo.id)) ?? { ...promo, active: false };

      await audit(c, {
        action: 'promo_code.deactivate',
        entity: { type: 'promo_code', id: promo.id },
        before: promo,
      });
      return c.json(
        { promo_code: toAdminPromoCode(updated, await PromoRedemptionRepo.countConfirmed(promo.id)) },
        200,
      );
    },
  );

export default promoCodes;
```

In `apps/api/src/admin/index.ts`: `import promoCodes from './routes/promo-codes';` and append `.route(`/admin/${API_VERSION}`, promoCodes)` to the `routes` chain (after `articles`).

- [ ] **Step 5: Fix the other admin test factories**

Run `grep -l "vi.mock('@shared/db'" apps/api/tests/admin.*.test.ts`; in each listed file add to the hoisted repos object:

```ts
  PromoCodeRepo: { create: vi.fn(), findByCode: vi.fn(), findById: vi.fn(), list: vi.fn(), deactivate: vi.fn() },
  PromoRedemptionRepo: { countConfirmed: vi.fn(), listByCode: vi.fn() },
```

Also add the same two entries to `apps/api/tests/billing.test.ts`'s factory if Task 4 didn't already cover the exact members used.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- admin` then `npm test`
Expected: PASS across the board.

- [ ] **Step 7: Lint + commit**

```bash
npm run lint:fix
git add apps/api packages/shared/schemas
git commit -m "feat(admin): promo code mint/list/deactivate/redemptions routes"
```

---

### Task 7: Admin SPA — Promo codes page

**Files:**
- Create: `apps/admin/src/pages/PromoCodesPage.tsx`
- Modify: `apps/admin/src/App.tsx` (route)
- Modify: `apps/admin/src/components/AuthedLayout.tsx` (header link)

**Interfaces:**
- Consumes: Task 6 admin routes via the typed `adminApi` client + `unwrap` (`apps/admin/src/lib/api.ts`); `@tanstack/react-query`.
- Produces: page at `/promo-codes`.

No unit tests in the admin SPA — the deliverable check is `npm run check:all` (typed client compiles against the new routes) plus a manual smoke via `npm run dev` if desired.

- [ ] **Step 1: Create the page**

`apps/admin/src/pages/PromoCodesPage.tsx` (dark-neutral Tailwind styling to match `AuthedLayout`; expandable per-row redemptions; create form; deactivate with `window.confirm`):

```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi, ApiError, unwrap } from '../lib/api';

type PromoCode = Awaited<ReturnType<typeof fetchCodes>>['promo_codes'][number];

const fetchCodes = () => adminApi.admin.v0['promo-codes'].$get().then(unwrap);

/** "30% off for 3 months" / "100% off forever" / "30% off the first payment". */
function discountLabel(p: PromoCode): string {
  if (p.duration === 'forever') return `${p.percent}% off forever`;
  if (p.duration === 'repeating') return `${p.percent}% off for ${p.duration_in_months} months`;
  return `${p.percent}% off the first payment`;
}

const emptyForm = {
  code: '',
  name: '',
  percent: '30',
  duration: 'repeating',
  duration_in_months: '3',
  max_redemptions: '',
  expires_at: '',
  affiliate: '',
};

export function PromoCodesPage() {
  const queryClient = useQueryClient();
  const codes = useQuery({ queryKey: ['promo-codes'], queryFn: fetchCodes });
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['promo-codes'] });

  const createMutation = useMutation({
    mutationFn: () =>
      adminApi.admin.v0['promo-codes']
        .$post({
          json: {
            code: form.code.trim() === '' ? undefined : form.code.trim().toUpperCase(),
            name: form.name.trim(),
            percent: Number(form.percent),
            duration: form.duration as 'once' | 'repeating' | 'forever',
            duration_in_months:
              form.duration === 'repeating' ? Number(form.duration_in_months) : undefined,
            max_redemptions:
              form.max_redemptions.trim() === '' ? undefined : Number(form.max_redemptions),
            expires_at: form.expires_at === '' ? undefined : new Date(form.expires_at).toISOString(),
            affiliate: form.affiliate.trim() === '' ? undefined : form.affiliate.trim(),
          },
        })
        .then(unwrap),
    onSuccess: () => {
      setForm(emptyForm);
      setFormError(null);
      void invalidate();
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.code : 'request failed'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) =>
      adminApi.admin.v0['promo-codes'][':promo_code_id'].deactivate
        .$post({ param: { promo_code_id: id } })
        .then(unwrap),
    onSuccess: () => void invalidate(),
  });

  const set = (key: keyof typeof emptyForm) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <h1 className="text-xl font-semibold">Promo codes</h1>

      <form
        className="space-y-3 rounded border border-neutral-800 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Code (blank = generated)">
            <input className={inputCls} value={form.code} onChange={(e) => set('code')(e.target.value)} placeholder="LAUNCH30" />
          </Field>
          <Field label="Name">
            <input className={inputCls} required value={form.name} onChange={(e) => set('name')(e.target.value)} placeholder="Launch promo" />
          </Field>
          <Field label="Percent off">
            <input className={inputCls} required type="number" min={1} max={100} value={form.percent} onChange={(e) => set('percent')(e.target.value)} />
          </Field>
          <Field label="Duration">
            <select className={inputCls} value={form.duration} onChange={(e) => set('duration')(e.target.value)}>
              <option value="once">once (first payment)</option>
              <option value="repeating">repeating (months)</option>
              <option value="forever">forever</option>
            </select>
          </Field>
          {form.duration === 'repeating' ? (
            <Field label="Months">
              <input className={inputCls} required type="number" min={1} value={form.duration_in_months} onChange={(e) => set('duration_in_months')(e.target.value)} />
            </Field>
          ) : null}
          <Field label="Max redemptions (blank = unlimited)">
            <input className={inputCls} type="number" min={1} value={form.max_redemptions} onChange={(e) => set('max_redemptions')(e.target.value)} />
          </Field>
          <Field label="Expires at (blank = never)">
            <input className={inputCls} type="date" value={form.expires_at} onChange={(e) => set('expires_at')(e.target.value)} />
          </Field>
          <Field label="Affiliate (attribution label)">
            <input className={inputCls} value={form.affiliate} onChange={(e) => set('affiliate')(e.target.value)} placeholder="jane" />
          </Field>
        </div>
        <p className="text-xs text-neutral-500">
          Heads-up: “repeating” counts months against billing cycles — a 3-month code applied at a
          yearly checkout discounts the entire first yearly payment.
        </p>
        {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
        >
          {createMutation.isPending ? 'Creating…' : 'Create code'}
        </button>
      </form>

      {codes.isLoading ? <p className="text-neutral-400">Loading…</p> : null}
      {codes.isError ? <p className="text-red-400">Could not load promo codes.</p> : null}
      {codes.data ? (
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-800 text-neutral-400">
            <tr>
              <th className="py-2 pr-4">Code</th>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Discount</th>
              <th className="py-2 pr-4">Affiliate</th>
              <th className="py-2 pr-4">Redemptions</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {codes.data.promo_codes.map((p) => (
              <>
                <tr key={p.id} className="border-b border-neutral-900">
                  <td className="py-2 pr-4 font-mono">{p.code}</td>
                  <td className="py-2 pr-4">{p.name}</td>
                  <td className="py-2 pr-4">{discountLabel(p)}</td>
                  <td className="py-2 pr-4">{p.affiliate ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      className="underline decoration-neutral-600 underline-offset-2"
                      onClick={() => setExpanded(expanded === p.id ? null : p.id)}
                    >
                      {p.confirmed_redemptions}
                      {p.max_redemptions !== null ? ` / ${p.max_redemptions}` : ''}
                    </button>
                  </td>
                  <td className="py-2 pr-4">{p.active ? 'active' : 'inactive'}</td>
                  <td className="py-2 text-right">
                    {p.active ? (
                      <button
                        type="button"
                        disabled={deactivateMutation.isPending}
                        onClick={() => {
                          if (window.confirm(`Deactivate ${p.code}? This cannot be undone.`)) {
                            deactivateMutation.mutate(p.id);
                          }
                        }}
                        className="rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800"
                      >
                        Deactivate
                      </button>
                    ) : null}
                  </td>
                </tr>
                {expanded === p.id ? (
                  <tr key={`${p.id}-redemptions`}>
                    <td colSpan={7} className="bg-neutral-900/50 px-4 py-2">
                      <Redemptions promoCodeId={p.id} />
                    </td>
                  </tr>
                ) : null}
              </>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function Redemptions({ promoCodeId }: { promoCodeId: string }) {
  const rows = useQuery({
    queryKey: ['promo-codes', promoCodeId, 'redemptions'],
    queryFn: () =>
      adminApi.admin.v0['promo-codes'][':promo_code_id'].redemptions
        .$get({ param: { promo_code_id: promoCodeId } })
        .then(unwrap),
  });
  if (rows.isLoading) return <p className="text-neutral-400">Loading…</p>;
  if (rows.isError || !rows.data) return <p className="text-red-400">Could not load redemptions.</p>;
  if (rows.data.redemptions.length === 0) return <p className="text-neutral-400">No redemptions yet.</p>;
  return (
    <ul className="space-y-1 text-xs text-neutral-300">
      {rows.data.redemptions.map((r) => (
        <li key={r.id}>
          org <span className="font-mono">{r.org_id}</span> — {r.status}
          {r.confirmed_at ? ` at ${new Date(r.confirmed_at).toLocaleString()}` : ''}
        </li>
      ))}
    </ul>
  );
}

const inputCls =
  'w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-sm text-neutral-100';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs text-neutral-400">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
```

Note for the implementer: match this page's data-fetch idioms to `apps/admin/src/lib/queries.ts` / an existing page like `SearchPage.tsx` if they differ from plain `useQuery` — the file above is the fallback shape.

- [ ] **Step 2: Wire route + nav**

`apps/admin/src/App.tsx`: `import { PromoCodesPage } from './pages/PromoCodesPage';` and inside the `AuthedLayout` route add `<Route path="/promo-codes" element={<PromoCodesPage />} />` (sibling of `/articles/:articleId`).

`apps/admin/src/components/AuthedLayout.tsx`: in the header, next to the "SeoPotion Admin" link, add:

```tsx
        <nav className="flex items-center gap-4 text-sm text-neutral-400">
          <Link to="/promo-codes" className="hover:text-neutral-100">
            Promo codes
          </Link>
        </nav>
```

(Place the existing brand `Link` and this `nav` together in a left-side flex container so the sign-out block stays right-aligned.)

- [ ] **Step 3: Verify**

Run: `npm run check:all && npm run lint`
Expected: PASS — the typed admin client compiles against the new routes.

- [ ] **Step 4: Commit**

```bash
git add apps/admin
git commit -m "feat(admin-spa): promo codes page"
```

---

### Task 8: Web billing page — promo input + i18n

**Files:**
- Modify: `apps/web/app/[locale]/(authenticated)/(product)/billing/page.tsx`
- Modify: `apps/web/messages/en.json`, `apps/web/messages/tr.json` (`BillingPage.promo`, `BillingPage.errors.invalid_promo` reasons)

**Interfaces:**
- Consumes: `POST /billing/promo/validate` and `promo_code` on checkout (Tasks 4–5) via the typed `api` client.
- Produces: user-visible promo flow on `/billing`.

No web unit tests exist for this page; verification is `npm run check:all` (typed client catches schema drift) + lint.

- [ ] **Step 1: Add i18n strings**

In `apps/web/messages/en.json` under `BillingPage` add:

```json
"promo": {
  "title": "Have a promo code?",
  "placeholder": "Enter code",
  "apply": "Apply",
  "applying": "Checking…",
  "applied": "{code} applied — {discount}",
  "remove": "Remove",
  "discount": {
    "once": "{percent}% off your first payment",
    "repeating": "{percent}% off for {months} months",
    "forever": "{percent}% off forever"
  },
  "errors": {
    "not_found": "That code doesn't exist.",
    "inactive": "This code is no longer active.",
    "expired": "This code has expired.",
    "exhausted": "This code has reached its redemption limit.",
    "already_redeemed": "This code has already been used for this organization.",
    "generic": "Could not check the code. Try again."
  }
}
```

In `apps/web/messages/tr.json` under `BillingPage` add:

```json
"promo": {
  "title": "Promosyon kodunuz var mı?",
  "placeholder": "Kodu girin",
  "apply": "Uygula",
  "applying": "Kontrol ediliyor…",
  "applied": "{code} uygulandı — {discount}",
  "remove": "Kaldır",
  "discount": {
    "once": "İlk ödemede %{percent} indirim",
    "repeating": "{months} ay boyunca %{percent} indirim",
    "forever": "Süresiz %{percent} indirim"
  },
  "errors": {
    "not_found": "Böyle bir kod yok.",
    "inactive": "Bu kod artık aktif değil.",
    "expired": "Bu kodun süresi dolmuş.",
    "exhausted": "Bu kod kullanım limitine ulaştı.",
    "already_redeemed": "Bu kod bu organizasyon için zaten kullanılmış.",
    "generic": "Kod kontrol edilemedi. Tekrar deneyin."
  }
}
```

- [ ] **Step 2: Implement the promo UI in `billing/page.tsx`**

Additions (match the file's existing idioms — `useMutation`, `CheckoutApiError`-style status handling, `StatusPanel`, `Card` primitives):

```tsx
type AppliedPromo = {
  code: string;
  percent: number;
  duration: 'once' | 'repeating' | 'forever';
  duration_in_months?: number;
};
type PromoReason =
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'exhausted'
  | 'already_redeemed'
  | 'generic';

class PromoApiError extends Error {
  reason: PromoReason | 'unauthorized';
  constructor(reason: PromoReason | 'unauthorized') {
    super(reason);
    this.name = 'PromoApiError';
    this.reason = reason;
  }
}
```

State + mutation inside `BillingPage` (near the checkout mutation):

```tsx
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState<PromoReason | null>(null);

  const promoMutation = useMutation({
    mutationFn: async (code: string): Promise<AppliedPromo> => {
      if (!organization) throw new Error('organization_required');
      const response = await api.api.v0.billing.promo.validate.$post({
        json: { org_id: organization.id, code },
      });
      const status = response.status as number;
      if (status === 401) throw new PromoApiError('unauthorized');
      if (status === 422) {
        const body = (await response.json()) as { reason: PromoReason };
        throw new PromoApiError(body.reason);
      }
      if (!response.ok) throw new PromoApiError('generic');
      return (await response.json()) as AppliedPromo;
    },
    onSuccess: (promo) => {
      setAppliedPromo(promo);
      setPromoInput('');
      setPromoError(null);
    },
    onError: (error) => {
      if (error instanceof PromoApiError && error.reason === 'unauthorized') {
        goToLogin();
        return;
      }
      setPromoError(error instanceof PromoApiError ? error.reason : 'generic');
    },
  });

  function discountLabel(promo: AppliedPromo): string {
    return t(`promo.discount.${promo.duration}`, {
      percent: promo.percent,
      months: promo.duration_in_months ?? 0,
    });
  }
```

Checkout mutation changes: include the code and handle the new 422 —

```tsx
      const response = await api.api.v0.billing.checkout.$post({
        json: { org_id: organization.id, tier, promo_code: appliedPromo?.code },
      });
```

and in the status handling, before the generic `!response.ok` branch:

```tsx
      if (status === 422) {
        const body = (await response.json()) as { reason: PromoReason };
        setAppliedPromo(null);
        throw new PromoApiError(body.reason);
      }
```

with the checkout `onError` extended to route `PromoApiError` reasons into `setPromoError` (unauthorized still goes to `goToLogin()`).

Render, below the tier-cards grid:

```tsx
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
              <Button disabled={promoMutation.isPending || promoInput.trim() === ''} type="submit" variant="outline">
                {promoMutation.isPending ? t('promo.applying') : t('promo.apply')}
              </Button>
            </form>
          )}
          {promoError ? (
            <p className="text-red-600 text-sm">{t(`promo.errors.${promoError}`)}</p>
          ) : null}
        </CardContent>
      </Card>
```

(If the shared `Button` lacks `size`/`variant="ghost"`, use whatever variants `apps/web/components/ui` actually exports — check the file.)

- [ ] **Step 3: Verify**

Run: `npm run check:all && npm run lint`
Expected: PASS. Optionally smoke locally: `docker compose up -d && npm run dev`, visit `/billing`, apply a garbage code → inline "That code doesn't exist."

- [ ] **Step 4: Commit**

```bash
git add apps/web
git commit -m "feat(web): promo code input on the billing page"
```

---

### Task 9: Docs, full verification, PR

**Files:**
- Modify: `PROGRESS.md` (billing line)

**Interfaces:** none.

- [ ] **Step 1: Update PROGRESS.md**

Extend the billing bullet (line ~47) with one clause, e.g.:

```
…; promo codes (LS-discount-backed, admin-minted, redemption attribution) — spec docs/superpowers/specs/2026-08-29-promo-codes-design.md.
```

- [ ] **Step 2: Full verification**

```bash
npm run lint && npm run check:all && npm test
```

```bash
docker compose up -d mongo && npm run test:integration
```

Expected: all PASS. Fix anything that fails before proceeding.

- [ ] **Step 3: Commit + PR**

```bash
git add PROGRESS.md
git commit -m "docs: note promo codes in PROGRESS"
git push -u origin claude/seopotion-promo-codes-cc43f6
```

Open a PR into `dev` titled `feat: promo codes (LS-discount-backed) with affiliate attribution`. Body: link the design spec, summarize the four surfaces (provider, customer API, admin, web), and list the two follow-ups that stay manual:

1. **LS test-mode verification** (cannot be unit-tested): confirm whether a 100%-forever checkout asks for a card; run one end-to-end 30%-repeating checkout and watch the redemption flip pending → confirmed. Requires staging LS credentials.
2. Codes minted before this deploy don't exist; `ensureIndexes` runs at deploy time and creates the new indexes — no migration needed (pre-alpha, no legacy docs).

---

## Deviations / notes for the implementer

- If zod 4's `.refine(...)` on an object blocks a later `.omit(...)` chain anywhere, use the base-object + refined-exports split exactly as written in Task 1 — that shape avoids the problem entirely.
- Vitest `toHaveBeenCalledWith` treats absent and `undefined`-valued keys as equal, which is why Task 5 doesn't touch the pre-existing checkout assertions. If a strict-equality matcher somewhere disagrees, update that assertion to include `discountCode: undefined`.
- The admin `@shared/db` mock factories are wholesale module replacements — a missing export breaks *import*, not just the test using it. Task 6 Step 5's grep sweep is mandatory, not optional.
