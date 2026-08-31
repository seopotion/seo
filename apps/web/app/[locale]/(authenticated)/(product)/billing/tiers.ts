import { type EntitlementPlan, planRank } from '@shared/schemas';

/** The tiers a user can buy. `free` is the absence of a purchase, not a tier. */
export const TIERS = ['paid', 'expert'] as const;
export type Tier = (typeof TIERS)[number];

/**
 * How a tier card renders against the org's current plan:
 * - `current` — the plan the org is on
 * - `owned`   — a lower tier, already covered by the current plan
 * - `upgrade` — still purchasable
 *
 * Mirrors the server's guard in `apps/api/src/routes/billing.ts`, which returns
 * 409 for a checkout at equal-or-higher rank, so only `upgrade` cards get a CTA.
 */
export type TierState = 'current' | 'owned' | 'upgrade';

export function tierState(current: EntitlementPlan, tier: Tier): TierState {
  if (current === tier) return 'current';
  return planRank(current) > planRank(tier) ? 'owned' : 'upgrade';
}

/** Whether any tier is still buyable — gates the promo form, which only applies at checkout. */
export function hasPurchasableTier(current: EntitlementPlan): boolean {
  return TIERS.some((tier) => tierState(current, tier) === 'upgrade');
}
