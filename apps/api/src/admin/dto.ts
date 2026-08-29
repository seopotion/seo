import type { z } from '@hono/zod-openapi';
import type {
  AdminAction,
  Article,
  Candidate,
  GscConnection,
  Keyword,
  Org,
  PromoCode,
  PromoRedemption,
  Subscription,
} from '@shared/schemas';
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

export function toAdminAuditAction(
  a: AdminAction,
): z.infer<typeof schemas.AdminAuditResponse>['actions'][number] {
  return {
    id: a.id,
    at: a.at.toISOString(),
    actor: a.actor,
    action: a.action,
    org_id: a.org_id,
    entity: a.entity,
    payload: a.payload,
    before: a.before ?? null,
  };
}

/** Customer `toCandidateItem` field set plus rejection_reason + serp_competitors. */
export function toAdminCandidateItem(c: Candidate): z.infer<typeof schemas.AdminCandidateItem> {
  return {
    id: c.id,
    keyword: c.keyword,
    search_volume: c.search_volume,
    difficulty: c.difficulty,
    cpc: c.cpc,
    competition: c.competition,
    trend: c.trend,
    intent: c.intent,
    article_type: c.article_type,
    relevance_score: c.relevance_score,
    opportunity_score: c.opportunity_score,
    source: c.source,
    status: c.status,
    schedulable: c.search_volume !== null && c.difficulty !== null && c.status === 'candidate',
    created_at: c.created_at.toISOString(),
    rejection_reason: c.rejection_reason,
    serp_competitors: c.serp_competitors,
  };
}

/** Customer `toScheduledKeyword` field set plus generation attempts/timing. */
export function toAdminScheduledKeyword(k: Keyword): z.infer<typeof schemas.AdminScheduledKeyword> {
  return {
    id: k.id,
    candidate_id: k.candidate_id,
    keyword: k.keyword,
    status: k.status,
    scheduled_date: k.scheduled_date,
    search_volume: k.search_volume,
    difficulty: k.difficulty,
    article_type: k.article_type,
    intent: k.intent,
    opportunity_score: k.opportunity_score,
    generation_status: k.generation_status,
    generation_error: k.generation_error,
    article_id: k.article_id,
    generation_attempts: k.generation_attempts,
    generation_started_at: k.generation_started_at?.toISOString() ?? null,
  };
}

/** Admin history row with operational image and legacy WordPress state. */
export function toAdminArticleListItem(
  a: Article,
): z.infer<typeof schemas.AdminArticlesResponse>['articles'][number] {
  return {
    id: a.id,
    title: a.title,
    slug: a.slug,
    keyword: a.keyword,
    status: a.status,
    difficulty: a.difficulty,
    search_volume: a.search_volume,
    featured_image_url: a.featured_image_url,
    created_at: a.created_at.toISOString(),
    published_at: a.published_at ? a.published_at.toISOString() : null,
    images_status: a.images_status,
    wordpress_post_id: a.wordpress_post_id ?? null,
  };
}

/** Same field set as the customer `toArticleDetail` (it contains no secrets). */
export function toAdminArticleDetail(a: Article): z.infer<typeof schemas.ArticleDetailResponse> {
  const publications = a.publications ?? [];
  const autoPublish = a.auto_publish ?? { preflight_error: null, attempts: [] };
  const mapError = (error: (typeof a.auto_publish)['preflight_error']) =>
    error
      ? { code: error.code, kind: error.kind, message: error.message, at: error.at.toISOString() }
      : null;
  return {
    id: a.id,
    keyword_id: a.keyword_id,
    keyword: a.keyword,
    title: a.title,
    meta_title: a.meta_title,
    slug: a.slug,
    meta_description: a.meta_description,
    featured_image_url: a.featured_image_url,
    content: a.content,
    status: a.status,
    ...(a.wordpress_post_id ? { wordpress_post_id: a.wordpress_post_id } : {}),
    static_site_published_at:
      publications.find((p) => p.provider === 'static-site')?.published_at.toISOString() ?? null,
    publications: publications.map((publication) => ({
      provider: publication.provider,
      ref: publication.ref,
      slug: publication.slug,
      remote_url: publication.remote_url ?? null,
      published_at: publication.published_at.toISOString(),
      updated_at: publication.updated_at?.toISOString() ?? null,
    })),
    auto_publish_error: mapError(autoPublish.preflight_error),
    auto_publish_attempts: autoPublish.attempts.map((attempt) => ({
      provider: attempt.provider,
      status: attempt.status,
      attempt_count: attempt.attempt_count,
      requested_at: attempt.requested_at.toISOString(),
      last_attempt_at: attempt.last_attempt_at?.toISOString() ?? null,
      last_error: mapError(attempt.last_error),
    })),
    images_status: a.images_status,
    created_at: a.created_at.toISOString(),
    updated_at: a.updated_at ? a.updated_at.toISOString() : null,
    published_at: a.published_at ? a.published_at.toISOString() : null,
    video: a.video,
  };
}

export function toAdminPromoCode(
  promo: PromoCode,
  confirmedRedemptions: number,
): z.infer<typeof schemas.AdminPromoCodeResponse>['promo_code'] {
  return {
    id: promo.id,
    code: promo.code,
    name: promo.name,
    percent: promo.percent,
    duration: promo.duration,
    duration_in_months: promo.duration_in_months ?? null,
    max_redemptions: promo.max_redemptions ?? null,
    expires_at: promo.expires_at?.toISOString() ?? null,
    active: promo.active,
    affiliate: promo.affiliate ?? null,
    ls_discount_id: promo.ls_discount_id,
    confirmed_redemptions: confirmedRedemptions,
    created_at: promo.created_at.toISOString(),
  };
}

export function toAdminPromoRedemption(
  row: PromoRedemption,
): z.infer<typeof schemas.AdminPromoRedemptionsResponse>['redemptions'][number] {
  return {
    id: row.id,
    org_id: row.org_id,
    status: row.status,
    created_at: row.created_at.toISOString(),
    confirmed_at: row.confirmed_at?.toISOString() ?? null,
  };
}
