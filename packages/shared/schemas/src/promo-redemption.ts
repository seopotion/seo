import { z } from 'zod';

/** pending = a checkout was created with the code; confirmed = the subscription activated. */
export const PROMO_REDEMPTION_STATUSES = ['pending', 'confirmed'] as const;
export type PromoRedemptionStatus = (typeof PROMO_REDEMPTION_STATUSES)[number];

/**
 * One org's use of one promo code — the affiliate-attribution record. Unique
 * per (code_id, org_id); only `confirmed` rows count against a code's
 * `max_redemptions`. See the promo-codes design spec §5.
 */
export const PromoRedemptionSchema = z.object({
  id: z.string(),
  code_id: z.string(),
  /** Denormalized code string so reports don't need a join. */
  code: z.string(),
  org_id: z.string(),
  status: z.enum(PROMO_REDEMPTION_STATUSES),
  created_at: z.date(),
  confirmed_at: z.date().optional(),
});
export type PromoRedemption = z.infer<typeof PromoRedemptionSchema>;
