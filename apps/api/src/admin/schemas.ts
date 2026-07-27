import { z } from '@hono/zod-openapi';
import {
  ONBOARDING_INTEGRATIONS,
  SetupPresetsSchema,
  SUBSCRIPTION_STATUSES,
} from '@shared/schemas';
import { ENTITLEMENT_PLANS, SETUP_STATUSES, STRATEGY_STATUSES } from '@shared/types';

export const AdminErrorResponse = z.object({ error: z.string() }).openapi('AdminError');

export const AdminLoginBody = z
  .object({
    id_token: z.string().openapi({ description: 'Google ID token from the operator sign-in' }),
  })
  .openapi('AdminLoginBody');

export const AdminLoginResponse = z
  .object({
    token: z.string().openapi({ description: 'Admin JWT — send as Authorization: Bearer' }),
  })
  .openapi('AdminLoginResponse');

export const AdminOrgSummary = z
  .object({
    id: z.string(),
    user_id: z.string(),
    website_url: z.string(),
    name: z.string().optional(),
    setup_status: z.enum(SETUP_STATUSES),
    plan: z.enum(ENTITLEMENT_PLANS),
    strategy_status: z.enum(STRATEGY_STATUSES),
    created_at: z.string(),
  })
  .openapi('AdminOrgSummary');

export const AdminOrgSearchQuery = z.object({
  query: z
    .string()
    .min(1)
    .openapi({ description: 'Org id, owner email, or website_url substring' }),
});

export const AdminOrgSearchResponse = z
  .object({ orgs: z.array(AdminOrgSummary) })
  .openapi('AdminOrgSearchResponse');

export const AdminOrgParams = z.object({ org_id: z.string() });

/** Org detail — `wordpress_token` is redacted to `{ connected, connected_at }`. */
const AdminOrg = AdminOrgSummary.extend({
  presets: SetupPresetsSchema.nullable(),
  domain_rating: z.object({ value: z.number().int(), checked_at: z.string() }).nullable(),
  onboarding: z
    .object({
      referral_source: z.string().optional(),
      integrations: z.array(z.enum(ONBOARDING_INTEGRATIONS)).optional(),
    })
    .nullable(),
  wordpress: z.object({ connected: z.boolean(), connected_at: z.string().nullable() }),
}).openapi('AdminOrg');

const AdminSubscription = z
  .object({
    id: z.string(),
    provider: z.string(),
    provider_customer_id: z.string(),
    provider_subscription_id: z.string(),
    tier: z.string(),
    status: z.enum(SUBSCRIPTION_STATUSES),
    current_period_end: z.string(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi('AdminSubscription');

/** GSC connection health — `refresh_token_enc` is never returned by anything. */
const AdminGscConnection = z
  .object({
    connected: z.boolean(),
    google_email: z.string(),
    site_url: z.string().nullable(),
    connected_at: z.string(),
    last_refresh_failed_at: z.string().nullable(),
  })
  .openapi('AdminGscConnection');

export const AdminOrgDetailResponse = z
  .object({
    org: AdminOrg,
    owner: z.object({ id: z.string(), email: z.string(), name: z.string().optional() }).nullable(),
    subscriptions: z.object({
      latest: AdminSubscription.nullable(),
      active: z.array(AdminSubscription),
    }),
    gsc: AdminGscConnection.nullable(),
    counts: z.object({
      scheduled_keywords: z.number().int(),
      articles_generated: z.number().int(),
      articles_published: z.number().int(),
    }),
  })
  .openapi('AdminOrgDetailResponse');

export const AdminSetPlanBody = z
  .object({ plan: z.enum(ENTITLEMENT_PLANS) })
  .openapi('AdminSetPlanBody');

export const AdminSetPlanResponse = z
  .object({
    plan: z.enum(ENTITLEMENT_PLANS),
    /** True when this call claimed and enqueued the strategy job. */
    strategy_kicked: z.boolean(),
  })
  .openapi('AdminSetPlanResponse');
