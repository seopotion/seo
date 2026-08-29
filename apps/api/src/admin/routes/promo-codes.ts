import { randomBytes } from 'node:crypto';
import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { PromoCodeRepo, PromoRedemptionRepo } from '@shared/db';
import { getBillingProvider } from '../../clients/billing';
import { audit } from '../audit';
import { toAdminPromoCode, toAdminPromoRedemption } from '../dto';
import type { AdminEnv } from '../middleware';
import * as schemas from '../schemas';

/** No ambiguous glyphs (I/L/O/0/1) — codes get read aloud and typed by hand. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  return Array.from(randomBytes(8), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/**
 * Promo code management (design spec 2026-08-29). Every code is backed by a
 * real LS discount: create LS-first (an orphan LS discount is harmless and
 * best-effort cleaned; a local doc without its LS discount would validate but
 * never apply). Not org-scoped, so audit rows carry org_id null.
 */
const promoCodes = new OpenAPIHono<AdminEnv>()
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/promo-codes',
      summary: 'Mint a promo code (creates the backing LS discount)',
      security: [{ Bearer: [] }],
      request: {
        body: {
          content: { 'application/json': { schema: schemas.AdminPromoCodeCreateBody } },
          required: true,
        },
      },
      responses: {
        201: {
          content: { 'application/json': { schema: schemas.AdminPromoCodeResponse } },
          description: 'Code created here and at LemonSqueezy',
        },
        401: { description: 'Missing or invalid admin token' },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'code_exists',
        },
      },
    }),
    async (c) => {
      const body = c.req.valid('json');
      const code = body.code ?? generateCode();
      if (await PromoCodeRepo.findByCode(code)) return c.json({ error: 'code_exists' }, 409);

      const provider = await getBillingProvider();
      const { providerDiscountId } = await provider.createDiscount({
        name: body.name,
        code,
        percent: body.percent,
        duration: body.duration,
        durationInMonths: body.duration_in_months,
        maxRedemptions: body.max_redemptions,
        expiresAt: body.expires_at,
      });

      let promo: Awaited<ReturnType<typeof PromoCodeRepo.create>>;
      try {
        promo = await PromoCodeRepo.create({
          code,
          name: body.name,
          percent: body.percent,
          duration: body.duration,
          duration_in_months: body.duration_in_months,
          max_redemptions: body.max_redemptions,
          expires_at: body.expires_at,
          active: true,
          affiliate: body.affiliate,
          ls_discount_id: providerDiscountId,
        });
      } catch (err) {
        // Don't leave a redeemable LS discount our validation knows nothing about.
        await provider.deleteDiscount(providerDiscountId).catch(() => {});
        throw err;
      }

      await audit(c, {
        action: 'promo_code.create',
        entity: { type: 'promo_code', id: promo.id },
        payload: { ...body, code },
      });
      return c.json({ promo_code: toAdminPromoCode(promo, 0) }, 201);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/promo-codes',
      summary: 'All promo codes with confirmed redemption counts',
      security: [{ Bearer: [] }],
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPromoCodesResponse } },
          description: 'Codes, newest first',
        },
        401: { description: 'Missing or invalid admin token' },
      },
    }),
    async (c) => {
      const codes = await PromoCodeRepo.list();
      const counts = await Promise.all(codes.map((p) => PromoRedemptionRepo.countConfirmed(p.id)));
      return c.json({ promo_codes: codes.map((p, i) => toAdminPromoCode(p, counts[i] ?? 0)) }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'get',
      path: '/promo-codes/{promo_code_id}/redemptions',
      summary: "A code's redemptions (the affiliate attribution report)",
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminPromoCodeParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPromoRedemptionsResponse } },
          description: 'Redemption rows, newest first',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Promo code not found',
        },
      },
    }),
    async (c) => {
      const { promo_code_id } = c.req.valid('param');
      const promo = await PromoCodeRepo.findById(promo_code_id);
      if (!promo) return c.json({ error: 'not_found' }, 404);
      const redemptions = await PromoRedemptionRepo.listByCode(promo.id);
      return c.json({ redemptions: redemptions.map(toAdminPromoRedemption) }, 200);
    },
  )
  .openapi(
    createRoute({
      tags: ['admin'],
      method: 'post',
      path: '/promo-codes/{promo_code_id}/deactivate',
      summary: 'Kill switch — deletes the LS discount; one-way in v1',
      security: [{ Bearer: [] }],
      request: { params: schemas.AdminPromoCodeParams },
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.AdminPromoCodeResponse } },
          description: 'Code deactivated (redemption history kept)',
        },
        401: { description: 'Missing or invalid admin token' },
        404: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'Promo code not found',
        },
        409: {
          content: { 'application/json': { schema: schemas.AdminErrorResponse } },
          description: 'already_inactive',
        },
      },
    }),
    async (c) => {
      const { promo_code_id } = c.req.valid('param');
      const promo = await PromoCodeRepo.findById(promo_code_id);
      if (!promo) return c.json({ error: 'not_found' }, 404);
      if (!promo.active) return c.json({ error: 'already_inactive' }, 409);

      // LS first: if the delete fails we 500 with the code still fully active
      // on both sides — never locally-dead but still redeemable at LS.
      const provider = await getBillingProvider();
      await provider.deleteDiscount(promo.ls_discount_id);
      const updated = (await PromoCodeRepo.deactivate(promo.id)) ?? { ...promo, active: false };

      await audit(c, {
        action: 'promo_code.deactivate',
        entity: { type: 'promo_code', id: promo.id },
        before: promo,
      });
      return c.json(
        {
          promo_code: toAdminPromoCode(updated, await PromoRedemptionRepo.countConfirmed(promo.id)),
        },
        200,
      );
    },
  );

export default promoCodes;
