import { z } from '@hono/zod-openapi';
import { ENTITLEMENT_PLANS, ORG_ROLES, SETUP_STATUSES } from '@shared/types';

export const LoginBody = z
  .object({
    id_token: z.string().openapi({ description: 'Google ID token from the frontend sign-in' }),
  })
  .openapi('LoginBody');

export const LoginResponse = z
  .object({
    token: z.string().openapi({ description: 'Session JWT — send as Authorization: Bearer' }),
  })
  .openapi('LoginResponse');

const Organization = z
  .object({
    id: z.string(),
    website_url: z.string(),
    setup_status: z.enum(SETUP_STATUSES),
    name: z.string().optional(),
    // Server-computed entitlement capabilities (#99) — the frontend must not
    // derive these from `plan` (#13 may move entitlement to Stripe state).
    capabilities: z.object({
      keyword_research: z.boolean(),
      keyword_scheduling: z.boolean(),
    }),
    // Display-only: lets the billing page label the current plan and offer
    // higher tiers. Gate features on `capabilities`, never on this.
    billing_tier: z.enum(ENTITLEMENT_PLANS),
    // owner = orgs.user_id; member = added by email (#333). Only billing and
    // team management are owner-only; the client does not gate anything else.
    role: z.enum(ORG_ROLES),
  })
  .openapi('Organization');

export const OrganizationsResponse = z
  .object({
    organizations: z.array(Organization),
  })
  .openapi('OrganizationsResponse');

export const CoreStatusResponse = z
  .object({
    setup_complete: z.boolean(),
  })
  .openapi('CoreStatusResponse');
