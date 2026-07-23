import { OrgRepo, SubscriptionRepo } from '@shared/db';
import type { BillingEvent, BillingProvider } from '@shared/providers';
import { logger } from '../../logger';

/** Non-activation events can reference a sub we never stored (e.g. one created
 * outside our checkout flow, or events racing ahead of `created`). Ignored, but
 * loudly — if it recurs, someone is paying without getting entitled. */
function warnUnknownSub(type: BillingEvent['type'], providerSubscriptionId: string): void {
  logger.warn('billing event ignored: unknown subscription', {
    type,
    provider_subscription_id: providerSubscriptionId,
  });
}

/**
 * Apply a provider-neutral billing event: the sole writer of both the
 * Subscription record and the org's entitlement (`Org.plan`). Idempotent —
 * webhooks are at-least-once. See the billing design spec.
 *
 * Access-until-expiry: `cancelled` only marks the subscription; the plan stays
 * until the paid period ends, when `expired` downgrades to `free` — unless
 * another subscription is still active (an upgrade checkout creates a NEW
 * provider subscription, so the old one expiring must not drop the org).
 * `past_due` keeps access (dunning).
 */
export async function applyBillingEvent(
  event: BillingEvent,
  provider: BillingProvider,
): Promise<void> {
  switch (event.type) {
    case 'subscription_activated': {
      await SubscriptionRepo.upsertFromEvent({
        org_id: event.orgId,
        provider: provider.name,
        provider_customer_id: event.providerCustomerId,
        provider_subscription_id: event.providerSubscriptionId,
        tier: event.tier,
        status: 'active',
        current_period_end: event.currentPeriodEnd,
      });
      await OrgRepo.setPlan(event.orgId, event.tier);
      // One live subscription per org: cancel any superseded still-active sub
      // so the user isn't double-billed after an upgrade. The provider's
      // cancelled/expired webhooks then update our records as usual. A failure
      // here 500s the webhook and the provider retries the whole (idempotent)
      // event, retrying the cancel with it.
      const superseded = (await SubscriptionRepo.listActiveByOrg(event.orgId)).filter(
        (sub) => sub.provider_subscription_id !== event.providerSubscriptionId,
      );
      for (const sub of superseded) {
        await provider.cancelSubscription(sub.provider_subscription_id);
      }
      return;
    }
    case 'subscription_updated': {
      const sub = await SubscriptionRepo.updateFromEvent({
        provider_subscription_id: event.providerSubscriptionId,
        tier: event.tier,
        status: event.status,
        current_period_end: event.currentPeriodEnd,
      });
      if (!sub) return warnUnknownSub(event.type, event.providerSubscriptionId);
      // active or past_due (dunning) keep access; cancelled/expired arrive via
      // their own events, so we don't downgrade here.
      if (event.status === 'active' || event.status === 'past_due') {
        await OrgRepo.setPlan(sub.org_id, event.tier);
      }
      return;
    }
    case 'subscription_cancelled': {
      // Status change only — access lasts until `expired`.
      const sub = await SubscriptionRepo.updateFromEvent({
        provider_subscription_id: event.providerSubscriptionId,
        status: 'cancelled',
      });
      if (!sub) warnUnknownSub(event.type, event.providerSubscriptionId);
      return;
    }
    case 'subscription_expired': {
      const sub = await SubscriptionRepo.updateFromEvent({
        provider_subscription_id: event.providerSubscriptionId,
        status: 'expired',
      });
      if (!sub) return warnUnknownSub(event.type, event.providerSubscriptionId);
      // Only downgrade when nothing else is active — a superseded sub expiring
      // after an upgrade must not drop an org that is paying for another tier.
      const active = await SubscriptionRepo.findActiveByOrg(sub.org_id);
      await OrgRepo.setPlan(sub.org_id, active ? active.tier : 'free');
      return;
    }
  }
}
