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
