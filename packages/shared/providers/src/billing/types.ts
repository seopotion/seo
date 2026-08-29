import type { PaidTier, PromoDuration, SubscriptionStatus } from '@shared/schemas';

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
      /** Absent when the provider carries no (valid) renewal date — e.g.
       * LemonSqueezy nulls `renews_at` once a subscription is cancelled. */
      currentPeriodEnd?: Date;
    }
  | { type: 'subscription_cancelled'; providerSubscriptionId: string }
  | { type: 'subscription_expired'; providerSubscriptionId: string };

/** A swappable billing backend. One implementation is live at a time. */
export interface BillingProvider {
  readonly name: 'lemonsqueezy';

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

  /** Verify the provider signature over the RAW request body. */
  verifyWebhook(rawBody: string, signature: string): boolean;

  /** Translate a verified provider payload into a BillingEvent, or null to ignore. */
  parseWebhookEvent(rawBody: string): BillingEvent | null;

  /** "Manage billing" link (cancel / update card). */
  getCustomerPortalUrl(providerCustomerId: string): Promise<{ url: string }>;

  /** Cancel a subscription (access-until-expiry semantics on the provider side). */
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
}
