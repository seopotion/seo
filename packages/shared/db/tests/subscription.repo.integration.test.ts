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
    await SubscriptionRepo.updateFromEvent({
      provider_subscription_id: 'sub_1',
      status: 'expired',
    });
    expect(await SubscriptionRepo.findActiveByOrg('o1')).toBeNull();
  });

  test('updateFromEvent returns null for an unknown subscription', async () => {
    expect(
      await SubscriptionRepo.updateFromEvent({
        provider_subscription_id: 'nope',
        status: 'active',
      }),
    ).toBeNull();
  });

  test('findLatestByOrg returns the most recent subscription regardless of status', async () => {
    await SubscriptionRepo.upsertFromEvent(
      evt({ org_id: 'o2', provider_subscription_id: 'sub_2', status: 'cancelled' }),
    );
    expect(await SubscriptionRepo.findActiveByOrg('o2')).toBeNull();
    const latest = await SubscriptionRepo.findLatestByOrg('o2');
    expect(latest?.provider_subscription_id).toBe('sub_2');
    expect(latest?.status).toBe('cancelled');
  });
});
