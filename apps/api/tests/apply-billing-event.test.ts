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
      expect.objectContaining({
        org_id: 'o1',
        provider_subscription_id: 'sub_1',
        tier: 'expert',
        status: 'active',
      }),
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
    expect(updateFromEvent).toHaveBeenCalledWith({
      provider_subscription_id: 'sub_1',
      status: 'cancelled',
    });
    expect(setPlan).not.toHaveBeenCalled();
  });

  test('expired: downgrades plan to free', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent({ type: 'subscription_expired', providerSubscriptionId: 'sub_1' });
    expect(updateFromEvent).toHaveBeenCalledWith({
      provider_subscription_id: 'sub_1',
      status: 'expired',
    });
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
