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
