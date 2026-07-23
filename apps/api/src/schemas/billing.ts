import { z } from '@hono/zod-openapi';
import { PAID_TIERS } from '@shared/schemas';

export const CheckoutBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    tier: z.enum(PAID_TIERS).openapi({ example: 'paid' }),
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
