import type { BillingProvider } from '@shared/providers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { upsertFromEvent, updateFromEvent, findActiveByOrg, listActiveByOrg, setPlan } = vi.hoisted(
  () => ({
    upsertFromEvent: vi.fn(),
    updateFromEvent: vi.fn(),
    findActiveByOrg: vi.fn(),
    listActiveByOrg: vi.fn(),
    setPlan: vi.fn(),
  }),
);
vi.mock('@shared/db', () => ({
  SubscriptionRepo: { upsertFromEvent, updateFromEvent, findActiveByOrg, listActiveByOrg },
  OrgRepo: { setPlan },
}));

import { applyBillingEvent } from '../src/lib/billing/apply-event';

const periodEnd = new Date('2026-08-22T00:00:00Z');

const cancelSubscription = vi.fn();
const provider = { cancelSubscription } as unknown as BillingProvider;

const activated = {
  type: 'subscription_activated',
  orgId: 'o1',
  providerCustomerId: 'c1',
  providerSubscriptionId: 'sub_1',
  tier: 'expert',
  currentPeriodEnd: periodEnd,
} as const;

describe('applyBillingEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listActiveByOrg.mockResolvedValue([]);
    findActiveByOrg.mockResolvedValue(null);
  });

  test('activated: upserts active sub and sets plan to the tier', async () => {
    upsertFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent(activated, provider);
    expect(upsertFromEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'o1',
        provider_subscription_id: 'sub_1',
        tier: 'expert',
        status: 'active',
      }),
    );
    expect(setPlan).toHaveBeenCalledWith('o1', 'expert');
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  test('activated: cancels superseded still-active subscriptions (one live sub per org)', async () => {
    upsertFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    // The upgrade checkout created sub_1; the old paid sub_0 is still active.
    listActiveByOrg.mockResolvedValue([
      { provider_subscription_id: 'sub_0', tier: 'paid' },
      { provider_subscription_id: 'sub_1', tier: 'expert' },
    ]);
    await applyBillingEvent(activated, provider);
    expect(cancelSubscription).toHaveBeenCalledTimes(1);
    expect(cancelSubscription).toHaveBeenCalledWith('sub_0');
  });

  test('updated active: keeps plan on the tier', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent(
      {
        type: 'subscription_updated',
        providerSubscriptionId: 'sub_1',
        tier: 'paid',
        status: 'active',
        currentPeriodEnd: periodEnd,
      },
      provider,
    );
    expect(setPlan).toHaveBeenCalledWith('o1', 'paid');
  });

  test('updated past_due: keeps access (plan stays on tier during dunning)', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent(
      {
        type: 'subscription_updated',
        providerSubscriptionId: 'sub_1',
        tier: 'paid',
        status: 'past_due',
        currentPeriodEnd: periodEnd,
      },
      provider,
    );
    expect(setPlan).toHaveBeenCalledWith('o1', 'paid');
  });

  test('cancelled: marks sub cancelled but leaves plan unchanged', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent(
      { type: 'subscription_cancelled', providerSubscriptionId: 'sub_1' },
      provider,
    );
    expect(updateFromEvent).toHaveBeenCalledWith({
      provider_subscription_id: 'sub_1',
      status: 'cancelled',
    });
    expect(setPlan).not.toHaveBeenCalled();
  });

  test('expired with no other active sub: downgrades plan to free', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    await applyBillingEvent(
      { type: 'subscription_expired', providerSubscriptionId: 'sub_1' },
      provider,
    );
    expect(updateFromEvent).toHaveBeenCalledWith({
      provider_subscription_id: 'sub_1',
      status: 'expired',
    });
    expect(setPlan).toHaveBeenCalledWith('o1', 'free');
  });

  test('expired while another sub is active (post-upgrade): keeps the active tier', async () => {
    updateFromEvent.mockResolvedValueOnce({ org_id: 'o1' });
    findActiveByOrg.mockResolvedValue({ org_id: 'o1', tier: 'expert' });
    await applyBillingEvent(
      { type: 'subscription_expired', providerSubscriptionId: 'sub_0' },
      provider,
    );
    expect(setPlan).toHaveBeenCalledWith('o1', 'expert');
    expect(setPlan).not.toHaveBeenCalledWith('o1', 'free');
  });

  test('lookup miss on expired: no throw, no setPlan', async () => {
    updateFromEvent.mockResolvedValueOnce(null);
    await expect(
      applyBillingEvent(
        { type: 'subscription_expired', providerSubscriptionId: 'ghost' },
        provider,
      ),
    ).resolves.toBeUndefined();
    expect(setPlan).not.toHaveBeenCalled();
  });

  test('lookup miss on updated: no throw, no setPlan', async () => {
    updateFromEvent.mockResolvedValueOnce(null);
    await expect(
      applyBillingEvent(
        {
          type: 'subscription_updated',
          providerSubscriptionId: 'ghost',
          tier: 'paid',
          status: 'active',
          currentPeriodEnd: periodEnd,
        },
        provider,
      ),
    ).resolves.toBeUndefined();
    expect(setPlan).not.toHaveBeenCalled();
  });
});
