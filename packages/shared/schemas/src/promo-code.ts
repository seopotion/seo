import { z } from 'zod';

/** How a discount applies over a subscription's life — mirrors LemonSqueezy. */
export const PROMO_DURATIONS = ['once', 'repeating', 'forever'] as const;
export type PromoDuration = (typeof PROMO_DURATIONS)[number];

/** `duration_in_months` is meaningful only for repeating discounts. */
const durationPairing = (p: { duration: PromoDuration; duration_in_months?: number }) =>
  (p.duration === 'repeating') === (p.duration_in_months !== undefined);

const PromoCodeBase = z.object({
  id: z.string(),
  /** Uppercase letters + digits only — the LS discount code constraint, narrowed. */
  code: z.string().regex(/^[A-Z0-9]{3,32}$/),
  name: z.string().min(1),
  /** Percent-off only in v1 (no fixed-amount codes). */
  percent: z.number().int().min(1).max(100),
  duration: z.enum(PROMO_DURATIONS),
  duration_in_months: z.number().int().min(1).optional(),
  /** Unset = unlimited. Mirrored onto the LS discount as the hard backstop. */
  max_redemptions: z.number().int().min(1).optional(),
  expires_at: z.date().optional(),
  /** Kill switch — deactivation also deletes the LS discount (one-way in v1). */
  active: z.boolean(),
  /** Free-text affiliate label for attribution reporting. */
  affiliate: z.string().optional(),
  ls_discount_id: z.string(),
  created_at: z.date(),
});

export const PromoCodeSchema = PromoCodeBase.refine(durationPairing, {
  message: 'duration_in_months is required iff duration is repeating',
});
export type PromoCode = z.infer<typeof PromoCodeSchema>;

/** Input for creating a promo code — the server assigns `id` and stamps `created_at`. */
export const CreatePromoCodeInput = PromoCodeBase.omit({ id: true, created_at: true }).refine(
  durationPairing,
  { message: 'duration_in_months is required iff duration is repeating' },
);
export type CreatePromoCodeInput = z.input<typeof CreatePromoCodeInput>;
