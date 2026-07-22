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
