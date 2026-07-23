import { ObjectId } from 'mongodb';
import { describe, expect, test, vi } from 'vitest';

const { findOneAndUpdate } = vi.hoisted(() => ({ findOneAndUpdate: vi.fn() }));
vi.mock('../src/client', () => ({
  getDb: async () => ({ collection: () => ({ findOneAndUpdate }) }),
}));

import { SubscriptionRepo } from '../src/repositories/subscription.repo';

const input = {
  org_id: 'o1',
  provider: 'lemonsqueezy' as const,
  provider_customer_id: 'cust_1',
  provider_subscription_id: 'sub_1',
  tier: 'paid' as const,
  status: 'active' as const,
  current_period_end: new Date('2026-08-22T00:00:00Z'),
};

const doc = {
  _id: new ObjectId(),
  ...input,
  created_at: new Date('2026-07-22T00:00:00Z'),
  updated_at: new Date('2026-07-22T00:00:00Z'),
};

describe('SubscriptionRepo.upsertFromEvent', () => {
  test('retries once when a concurrent upsert races into a duplicate-key error', async () => {
    findOneAndUpdate
      .mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }))
      .mockResolvedValueOnce(doc);
    const res = await SubscriptionRepo.upsertFromEvent(input);
    expect(res.provider_subscription_id).toBe('sub_1');
    expect(findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  test('propagates non-duplicate-key errors', async () => {
    findOneAndUpdate.mockReset();
    findOneAndUpdate.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 1 }));
    await expect(SubscriptionRepo.upsertFromEvent(input)).rejects.toThrow('boom');
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
  });
});
