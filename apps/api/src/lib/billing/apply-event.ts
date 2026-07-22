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
