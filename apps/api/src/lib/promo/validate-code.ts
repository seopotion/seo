import { PromoCodeRepo, PromoRedemptionRepo } from '@shared/db';
import type { PromoCode } from '@shared/schemas';
import type { PromoRejectReason } from '../../schemas/billing';

export type PromoValidation =
  | { ok: true; promo: PromoCode }
  | { ok: false; reason: PromoRejectReason };

/**
 * The UX gate for promo codes — checked at apply time and re-checked at
 * checkout. The mirrored LS max_redemptions/expires_at are the hard backstop
 * against races (design spec §5), so a small TOCTOU window here is fine.
 */
export async function validatePromoCode(rawCode: string, orgId: string): Promise<PromoValidation> {
  const code = rawCode.trim().toUpperCase();
  const promo = await PromoCodeRepo.findByCode(code);
  if (!promo) return { ok: false, reason: 'not_found' };
  if (!promo.active) return { ok: false, reason: 'inactive' };
  if (promo.expires_at && promo.expires_at.getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  if (await PromoRedemptionRepo.findConfirmedByCodeAndOrg(promo.id, orgId)) {
    return { ok: false, reason: 'already_redeemed' };
  }
  if (
    promo.max_redemptions !== undefined &&
    (await PromoRedemptionRepo.countConfirmed(promo.id)) >= promo.max_redemptions
  ) {
    return { ok: false, reason: 'exhausted' };
  }
  return { ok: true, promo };
}
