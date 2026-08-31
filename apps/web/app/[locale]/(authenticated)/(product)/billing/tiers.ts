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

/**
 * The org fields the post-checkout activation poll reads — a structural subset
 * of `ProductOrganization`, kept local so this module stays importable from a
 * plain unit test.
 */
type ActivationOrganization = {
  billing_tier: EntitlementPlan;
  capabilities: { keyword_research: boolean };
};

/**
 * The tier a checkout redirect says was just bought, or `null` when the `tier`
 * query param is absent or not a tier we sell — checkout links minted before
 * the param existed are still in flight, and the URL is user-editable.
 */
export function parsePurchasedTier(value: string | null | undefined): Tier | null {
  return (TIERS as readonly string[]).includes(value ?? '') ? (value as Tier) : null;
}

/**
 * Whether the entitlement webhook behind a checkout has landed yet.
 *
 * With a known purchased tier, wait for the org to actually reach it: a `paid`
 * org buying `expert` already satisfies `keyword_research`, so that flag alone
 * would end the poll before the upgrade applied. Without one, fall back to the
 * paid capability — all a tier-less redirect could ever confirm.
 *
 * Confirmation only. Feature gating stays on `capabilities` (#99).
 */
export function isActivated(
  organization: ActivationOrganization | null,
  purchasedTier: Tier | null,
): boolean {
  if (!organization) return false;
  if (!purchasedTier) return organization.capabilities.keyword_research;
  return planRank(organization.billing_tier) >= planRank(purchasedTier);
}
