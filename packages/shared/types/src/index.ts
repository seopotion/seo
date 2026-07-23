/**
 * Setup/onboarding status progression. Shared by the API schemas, the DB
 * entity schemas, and the frontend so the state machine has one definition.
 *
 * See design/product-flow.md for the flow these statuses drive.
 */
export const SETUP_STATUSES = [
  'setup_not_started',
  'setup_scan_in_progress',
  'setup_scan_completed',
  'setup_complete',
] as const;

export type SetupStatus = (typeof SETUP_STATUSES)[number];

/** Billing entitlement plans. `paid`/`expert` unlock the automated pipeline (#56);
 * `expert` additionally grants human-operator assistance + extra features (#13). */
export const ENTITLEMENT_PLANS = ['free', 'paid', 'expert'] as const;
export type EntitlementPlan = (typeof ENTITLEMENT_PLANS)[number];

/** Lifecycle of an org's automatic 30-day strategy job (#47). */
export const STRATEGY_STATUSES = ['none', 'pending', 'completed', 'failed'] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number];
