import { ENTITLEMENT_PLANS, SETUP_STATUSES, STRATEGY_STATUSES } from '@shared/types';
import { z } from 'zod';
import { SetupPresetsSchema } from './presets';

/** Publishing platforms a user can select during onboarding (#73). */
export const ONBOARDING_INTEGRATIONS = ['wordpress', 'wordpress-com', 'framer'] as const;

/**
 * Organization entity — the shape app code and the API work with.
 * `id` is a string (the stringified Mongo `_id`); the raw `_id` never
 * leaves the repository layer. See design/data-layer.md.
 */
export const OrgSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  website_url: z.string().url(),
  setup_status: z.enum(SETUP_STATUSES),
  // Billing entitlement. Defaults keep orgs stored before #56 backward-compatible.
  plan: z.enum(ENTITLEMENT_PLANS).default('free'),
  // Automatic-strategy job lifecycle (#47).
  strategy_status: z.enum(STRATEGY_STATUSES).default('none'),
  name: z.string().optional(),
  wordpress_token: z.string().optional(),
  wordpress_connected_at: z.date().optional(),
  // Populated by the scanner worker once scanning completes.
  presets: SetupPresetsSchema.optional(),
  // Latest 0–100 Domain Rating for the dashboard badge (#12); refreshed by the
  // scanner worker and the stale-refresh path in GET /dashboard/domain-rating.
  domain_rating: z
    .object({ value: z.number().int().min(0).max(100), checked_at: z.date() })
    .optional(),
  // Onboarding metadata captured at finalize (#73). Distinct from the connected
  // integrations concept (dashboard.integrations.connected).
  onboarding: z
    .object({
      referral_source: z.string().optional(),
      integrations: z.array(z.enum(ONBOARDING_INTEGRATIONS)).optional(),
    })
    .optional(),
  created_at: z.date(),
});
export type Org = z.infer<typeof OrgSchema>;

/**
 * Input for creating an org — the server assigns `id` and `created_at`, and the
 * WordPress connection fields are server-owned (written only by
 * `saveWordPressConnection` after a successful integration test).
 */
export const CreateOrgInput = OrgSchema.omit({
  id: true,
  created_at: true,
  presets: true,
  wordpress_token: true,
  wordpress_connected_at: true,
});
// z.input (not z.infer): `plan`/`strategy_status` have defaults, so callers may omit them.
export type CreateOrgInput = z.input<typeof CreateOrgInput>;

/** True when the org has an active paid entitlement (paid or expert). Backed by
 * billing webhooks (#13); the `db set-plan` CLI can also flip it. */
export function isPaid(org: Org): boolean {
  return org.plan === 'paid' || org.plan === 'expert';
}

/** True when the org is on the expert tier (human-operator assistance + extras). */
export function hasExpert(org: Org): boolean {
  return org.plan === 'expert';
}
