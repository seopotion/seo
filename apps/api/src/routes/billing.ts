import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { PromoRedemptionRepo, SubscriptionRepo } from '@shared/db';
import type { PromoCode } from '@shared/schemas';
import { isPaid, planRank } from '@shared/schemas';
import { getBillingProvider } from '../clients/billing';
import { applyBillingEvent } from '../lib/billing/apply-event';
import { loadOwnedOrg } from '../lib/load-owned-org';
import { validatePromoCode } from '../lib/promo/validate-code';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/billing';

/**
 * Billing routes (#13). Checkout + portal are Bearer-gated; the webhook is the
 * one public route (verified by provider signature, not a JWT). Chained
 * `.openapi()` so the type + spec capture every endpoint.
 */
const billing = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['billing'],
      method: 'post',
      path: '/checkout',
      summary: 'Create a hosted checkout for a paid tier',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.CheckoutBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.CheckoutResponse } },
          description: 'Checkout URL',
        },
        403: { description: 'Org not found or not owned by the caller' },
        409: { description: 'Already subscribed at this tier or higher' },
        422: {
          content: { 'application/json': { schema: schemas.CheckoutPromoErrorResponse } },
          description: 'The promo code failed validation',
        },
      },
    }),
    async (c) => {
      const { org_id, tier, promo_code } = c.req.valid('json');
      const { userId, email } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
      // Already entitled at an equal-or-higher tier -> send them to the portal instead.
      if (isPaid(org) && planRank(org.plan) >= planRank(tier)) return c.body(null, 409);
      // Re-validate at checkout time — the code may have died since apply.
      let promo: PromoCode | undefined;
      if (promo_code) {
        const result = await validatePromoCode(promo_code, org.id);
        if (!result.ok) {
          return c.json({ error: 'invalid_promo' as const, reason: result.reason }, 422);
        }
        promo = result.promo;
      }
      const provider = await getBillingProvider();
      const { url } = await provider.createCheckout({
        tier,
        orgId: org.id,
        userEmail: email,
        discountCode: promo?.code,
      });
      // Pending until the subscription webhook confirms; idempotent per (code, org).
      if (promo) await PromoRedemptionRepo.upsertPending(promo.id, promo.code, org.id);
      return c.json({ url }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['billing'],
      method: 'post',
      path: '/portal',
      summary: 'Get the manage-billing portal URL',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: { content: { 'application/json': { schema: schemas.PortalBody } }, required: true },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.PortalResponse } },
          description: 'Portal URL',
        },
        403: { description: 'Org not found or not owned by the caller' },
        404: { description: 'No subscription for this org' },
      },
    }),
    async (c) => {
      const { org_id } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
      const sub = await SubscriptionRepo.findLatestByOrg(org.id);
      if (!sub) return c.body(null, 404);
      const provider = await getBillingProvider();
      const { url } = await provider.getCustomerPortalUrl(sub.provider_customer_id);
      return c.json({ url }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['billing'],
      method: 'post',
      path: '/promo/validate',
      summary: 'Validate a promo code for an org (pre-checkout)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      request: {
        body: {
          content: { 'application/json': { schema: schemas.PromoValidateBody } },
          required: true,
        },
      },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.PromoValidateResponse } },
          description: 'The code is applicable; discount terms for display',
        },
        403: { description: 'Org not found or not owned by the caller' },
        422: {
          content: { 'application/json': { schema: schemas.PromoInvalidResponse } },
          description: 'Code rejected (see reason)',
        },
      },
    }),
    async (c) => {
      const { org_id, code } = c.req.valid('json');
      const { userId } = c.get('auth');
      const org = await loadOwnedOrg(org_id, userId);
      if (!org) return c.body(null, 403);
      const result = await validatePromoCode(code, org.id);
      if (!result.ok) return c.json({ valid: false as const, reason: result.reason }, 422);
      const { promo } = result;
      return c.json(
        {
          valid: true as const,
          code: promo.code,
          percent: promo.percent,
          duration: promo.duration,
          duration_in_months: promo.duration_in_months,
        },
        200,
      );
    },
  )
  .openapi(
    createRoute({
      tags: ['billing'],
      method: 'post',
      path: '/webhook/lemonsqueezy',
      summary: 'LemonSqueezy webhook (public; signature-verified)',
      // No request-body schema: the handler verifies the raw provider signature
      // itself (`c.req.text()`), so no `.valid('json')` schema is ever read —
      // declaring one here would make zod-openapi validate/reject the raw
      // provider payload against it before the handler (and signature check) runs.
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.WebhookResponse } },
          description: 'Acknowledged',
        },
        401: { description: 'Invalid signature' },
      },
    }),
    async (c) => {
      // Verify over the RAW body byte-for-byte — must read text, not parsed JSON.
      const raw = await c.req.text();
      const signature = c.req.header('X-Signature') ?? '';
      const provider = await getBillingProvider();
      if (!provider.verifyWebhook(raw, signature)) return c.body(null, 401);
      const event = provider.parseWebhookEvent(raw);
      if (event) await applyBillingEvent(event, provider);
      return c.json({ received: true }, 200);
    },
  );

export default billing;
