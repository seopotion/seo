import { z } from 'zod';

/** Provider-neutral subscription lifecycle status. */
export const SUBSCRIPTION_STATUSES = ['active', 'past_due', 'cancelled', 'expired'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Paid entitlement tiers a subscription can grant (never `free`). */
export const PAID_TIERS = ['paid', 'expert'] as const;
export type PaidTier = (typeof PAID_TIERS)[number];

/**
 * A billing subscription for an org. Provider-specific ids live here; the
 * neutral entitlement (`Org.plan`) is derived from `tier` + `status` by the
 * applier. `provider` widens to 'stripe' later with no schema change.
 * See design/../specs/2026-07-22-billing-provider-abstraction-design.md.
 */
export const SubscriptionSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  provider: z.enum(['lemonsqueezy']),
  provider_customer_id: z.string(),
  provider_subscription_id: z.string(),
  tier: z.enum(PAID_TIERS),
  status: z.enum(SUBSCRIPTION_STATUSES),
  current_period_end: z.date(),
  created_at: z.date(),
  updated_at: z.date(),
});
export type Subscription = z.infer<typeof SubscriptionSchema>;

/** Input for creating a subscription — the server assigns `id`. */
export const CreateSubscriptionInput = SubscriptionSchema.omit({ id: true });
export type CreateSubscriptionInput = z.input<typeof CreateSubscriptionInput>;
