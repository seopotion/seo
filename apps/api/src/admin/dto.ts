import type { z } from '@hono/zod-openapi';
import type { GscConnection, Org, Subscription } from '@shared/schemas';
import { isGscConnected } from '@shared/schemas';
import type * as schemas from './schemas';

/**
 * Admin DTO mappers — the admin API's own (do not import from customer route
 * files). Responses only ever contain these shapes, never raw entities:
 * `wordpress_token` is redacted to `{ connected, connected_at }` and
 * `refresh_token_enc` is never returned by anything.
 */

export function toAdminOrgSummary(org: Org): z.infer<typeof schemas.AdminOrgSummary> {
  return {
    id: org.id,
    user_id: org.user_id,
    website_url: org.website_url,
    name: org.name,
    setup_status: org.setup_status,
    plan: org.plan,
    strategy_status: org.strategy_status,
    created_at: org.created_at.toISOString(),
  };
}

export function toAdminOrg(org: Org): z.infer<typeof schemas.AdminOrgDetailResponse>['org'] {
  return {
    ...toAdminOrgSummary(org),
    presets: org.presets ?? null,
    domain_rating: org.domain_rating
      ? { value: org.domain_rating.value, checked_at: org.domain_rating.checked_at.toISOString() }
      : null,
    onboarding: org.onboarding ?? null,
    wordpress: {
      connected: Boolean(org.wordpress_token),
      connected_at: org.wordpress_connected_at?.toISOString() ?? null,
    },
  };
}

export function toAdminSubscription(
  sub: Subscription,
): z.infer<typeof schemas.AdminOrgDetailResponse>['subscriptions']['active'][number] {
  return {
    id: sub.id,
    provider: sub.provider,
    provider_customer_id: sub.provider_customer_id,
    provider_subscription_id: sub.provider_subscription_id,
    tier: sub.tier,
    status: sub.status,
    current_period_end: sub.current_period_end.toISOString(),
    created_at: sub.created_at.toISOString(),
    updated_at: sub.updated_at.toISOString(),
  };
}

export function toAdminGsc(
  conn: GscConnection,
): NonNullable<z.infer<typeof schemas.AdminOrgDetailResponse>['gsc']> {
  return {
    connected: isGscConnected(conn),
    google_email: conn.google_email,
    site_url: conn.site_url,
    connected_at: conn.connected_at.toISOString(),
    last_refresh_failed_at: conn.last_refresh_failed_at?.toISOString() ?? null,
  };
}
