import { z } from '@hono/zod-openapi';
import { PAID_TIERS, PROMO_DURATIONS } from '@shared/schemas';

export const CheckoutBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    tier: z.enum(PAID_TIERS).openapi({ example: 'paid' }),
    /** Already-validated promo code; re-validated server-side at checkout. */
    promo_code: z.string().trim().min(1).max(64).optional().openapi({ example: 'LAUNCH30' }),
  })
  .openapi('CheckoutBody');

export const CheckoutResponse = z
  .object({
    url: z.string().url().openapi({ example: 'https://store.lemonsqueezy.com/checkout/...' }),
  })
  .openapi('CheckoutResponse');

export const PortalBody = z
  .object({ org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }) })
  .openapi('PortalBody');

export const PortalResponse = z
  .object({ url: z.string().url().openapi({ example: 'https://store.lemonsqueezy.com/billing' }) })
  .openapi('PortalResponse');

export const WebhookResponse = z.object({ received: z.boolean() }).openapi('WebhookResponse');

export const OwnerOnlyResponse = z
  .object({ error: z.literal('Owner only') })
  .openapi('OwnerOnlyResponse');

export const PROMO_REJECT_REASONS = [
  'not_found',
  'inactive',
  'expired',
  'exhausted',
  'already_redeemed',
] as const;
export type PromoRejectReason = (typeof PROMO_REJECT_REASONS)[number];

export const PromoValidateBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    code: z.string().trim().min(1).max(64).openapi({ example: 'LAUNCH30' }),
  })
  .openapi('PromoValidateBody');

export const PromoValidateResponse = z
  .object({
    valid: z.literal(true),
    code: z.string(),
    percent: z.number().int(),
    duration: z.enum(PROMO_DURATIONS),
    duration_in_months: z.number().int().optional(),
  })
  .openapi('PromoValidateResponse');

export const PromoInvalidResponse = z
  .object({ valid: z.literal(false), reason: z.enum(PROMO_REJECT_REASONS) })
  .openapi('PromoInvalidResponse');

export const CheckoutPromoErrorResponse = z
  .object({ error: z.literal('invalid_promo'), reason: z.enum(PROMO_REJECT_REASONS) })
  .openapi('CheckoutPromoErrorResponse');
