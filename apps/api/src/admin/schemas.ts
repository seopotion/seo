import { z } from '@hono/zod-openapi';
import { extractH2s } from '@shared/generation';
import {
  ARTICLE_STATUSES,
  ARTICLE_TYPES,
  ArticleImageSchema,
  CANDIDATE_STATUSES,
  IMAGES_STATUSES,
  ONBOARDING_INTEGRATIONS,
  PROMO_DURATIONS,
  PROMO_REDEMPTION_STATUSES,
  REJECTION_REASONS,
  SEARCH_INTENTS,
  SerpCompetitorSchema,
  SetupPresetsSchema,
  SUBSCRIPTION_STATUSES,
} from '@shared/schemas';
import { ENTITLEMENT_PLANS, SETUP_STATUSES, STRATEGY_STATUSES } from '@shared/types';
import { ArticleDetailResponse as CustomerArticleDetailResponse } from '../schemas/dashboard';
// Customer request/response schemas reused directly (single-sourced shapes) —
// these live in apps/api/src/schemas/*, never in route files.
import { CandidateItem, KeywordMetric, ScheduledKeyword } from '../schemas/keywords';
import { SetupPresetsPatchSchema } from '../schemas/setup';

export {
  ArticleUpdateBody,
  ArticleValidationErrorResponse,
  WordPressArticleErrorResponse,
  WordPressArticleResponse,
} from '../schemas/dashboard';

export const ArticleDetailResponse = CustomerArticleDetailResponse.extend({
  images: z.array(ArticleImageSchema.extend({ generated_at: z.string().nullable() })),
  image_headings: z.array(z.string()),
}).openapi('AdminArticleDetailResponse');

export function imageHeadings(content: string): string[] {
  const headings = extractH2s(content);
  return headings.filter((heading) => headings.filter((other) => other === heading).length === 1);
}

export const MAX_UPLOAD_IMAGE_BYTES = 5 * 1024 * 1024;
export const AdminImageUploadBody = z
  .object({
    role: z.enum(['cover', 'inline']),
    section_heading: z.string().min(1).max(500).nullable(),
    alt: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .regex(/^[^\r\n]+$/),
    content_type: z.enum(['image/webp', 'image/jpeg', 'image/png']),
    size: z.number().int().min(1).max(MAX_UPLOAD_IMAGE_BYTES),
  })
  .strict()
  .openapi('AdminImageUploadBody');
export type AdminImageUploadBody = z.infer<typeof AdminImageUploadBody>;

export const AdminImageUploadResponse = z
  .object({
    upload_url: z.string(),
    headers: z.record(z.string(), z.string()),
    upload_token: z.string(),
  })
  .openapi('AdminImageUploadResponse');
export const AdminImageFinalizeBody = z
  .object({
    upload_token: z.string().min(1).max(6000),
  })
  .strict()
  .openapi('AdminImageFinalizeBody');
export { ScheduleBody } from '../schemas/keywords';

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

// --- Audit read (Phase 1) ---

export const AdminAuditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const AdminAuditAction = z
  .object({
    id: z.string(),
    at: z.string(),
    actor: z.string(),
    action: z.string(),
    /** null for org-independent actions (promo codes). */
    org_id: z.string().nullable(),
    entity: z.object({ type: z.string(), id: z.string() }).nullable(),
    payload: z.unknown(),
    before: z.unknown().nullable(),
  })
  .openapi('AdminAuditAction');

export const AdminAuditResponse = z
  .object({ actions: z.array(AdminAuditAction), total: z.number().int() })
  .openapi('AdminAuditResponse');

// --- Presets + strategy (Phase 1) ---

export const AdminPresetsPatchBody = SetupPresetsPatchSchema;

export const AdminPresetsResponse = z
  .object({ presets: SetupPresetsSchema })
  .openapi('AdminPresetsResponse');

export const AdminStrategyRunBody = z
  .object({
    /** Force-rerun of a completed strategy: resets the status, then claims.
     * Safe to repeat — the pipeline dedupes against existing planner keywords
     * and pool candidates. */
    force: z.boolean().optional(),
  })
  .openapi('AdminStrategyRunBody');

export const AdminStrategyRunResponse = z
  .object({ strategy_status: z.literal('pending') })
  .openapi('AdminStrategyRunResponse');

// --- Phase 2 unstick levers ---

export const AdminEnqueuedResponse = z
  .object({ enqueued: z.literal(true) })
  .openapi('AdminEnqueuedResponse');

/** Editable planner-brief fields; at least one must be present. */
export const AdminBriefPatchBody = z
  .object({
    article_type: z.enum(ARTICLE_TYPES).nullable().optional(),
    intent: z.enum(SEARCH_INTENTS).nullable().optional(),
    opportunity_score: z.number().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' })
  .openapi('AdminBriefPatchBody');

export const AdminWordPressConnectBody = z
  .object({ token: z.string().min(1) })
  .openapi('AdminWordPressConnectBody');

export const AdminWordPressConnectResponse = z
  .object({ success: z.literal(true) })
  .openapi('AdminWordPressConnectResponse');

export const AdminWordPressConnectErrorResponse = z
  .object({ success: z.literal(false), error_code: z.string() })
  .openapi('AdminWordPressConnectErrorResponse');

// --- Keyword curation (Phase 1) ---

export const AdminResearchBody = z
  .object({ seed: z.string().trim().min(1).max(200) })
  .openapi('AdminResearchBody');

export const AdminResearchResponse = z
  .object({ seed: KeywordMetric, similar: z.array(KeywordMetric) })
  .openapi('AdminResearchResponse');

/** No status default: an omitted status returns the whole pool incl. rejected. */
export const AdminCandidatesQuery = z.object({
  status: z.enum(CANDIDATE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Customer row plus the operator-only fields (epic #150 DTO spec). */
export const AdminCandidateItem = CandidateItem.extend({
  rejection_reason: z.enum(REJECTION_REASONS).nullable(),
  serp_competitors: z.array(SerpCompetitorSchema).nullable(),
}).openapi('AdminCandidateItem');

export const AdminCandidatesResponse = z
  .object({
    candidates: z.array(AdminCandidateItem),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .openapi('AdminCandidatesResponse');

export const AdminAddCandidatesBody = z
  .object({ keywords: z.array(KeywordMetric).min(1) })
  .openapi('AdminAddCandidatesBody');

export const AdminAddCandidatesResponse = z
  .object({ added: z.number().int(), skipped: z.number().int() })
  .openapi('AdminAddCandidatesResponse');

export const AdminCandidateParams = z.object({ candidate_id: z.string() });

// --- Planner (Phase 1) ---

export const AdminKeywordParams = z.object({ keyword_id: z.string() });

/** Customer row plus the operator-only generation fields (epic #150 DTO spec). */
export const AdminScheduledKeyword = ScheduledKeyword.extend({
  generation_attempts: z.number().int(),
  generation_started_at: z.string().nullable(),
}).openapi('AdminScheduledKeyword');

export const AdminScheduledKeywordResponse = z
  .object({ keyword: AdminScheduledKeyword })
  .openapi('AdminScheduledKeywordResponse');

export const AdminPlannerResponse = z
  .object({
    strategy_status: z.enum(STRATEGY_STATUSES),
    keywords: z.array(AdminScheduledKeyword),
  })
  .openapi('AdminPlannerResponse');

export const AdminGenerateNowResponse = z
  .object({ enqueued: z.literal(true) })
  .openapi('AdminGenerateNowResponse');

// --- Articles (Phase 1) ---

export const AdminArticleParams = z.object({ article_id: z.string() });

export const AdminArticleCreateBody = z
  .object({
    keyword: z.string().nullable(),
    title: z.string(),
    slug: z.string(),
    meta_title: z.string(),
    meta_description: z.string(),
    content: z.string(),
  })
  .openapi('AdminArticleCreateBody');

export const AdminArticlesQuery = z.object({
  status: z.enum(ARTICLE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Admin history row with operational image and provider publication state. */
const AdminArticleListItem = z
  .object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    keyword: z.string().nullable(),
    status: z.enum(ARTICLE_STATUSES),
    difficulty: z.number().int().nullable(),
    search_volume: z.number().int().nullable(),
    featured_image_url: z.string(),
    created_at: z.string(),
    published_at: z.string().nullable(),
    images_status: z.enum(IMAGES_STATUSES),
    wordpress_post_id: z.number().int().nullable(),
    published_to: z.array(z.enum(['wordpress', 'static-site'])),
  })
  .openapi('AdminArticleListItem');

export const AdminArticlesResponse = z
  .object({ articles: z.array(AdminArticleListItem), total: z.number().int() })
  .openapi('AdminArticlesResponse');

export const AdminPublishingTarget = z
  .object({
    provider: z.enum(['wordpress', 'static-site']),
    target: z.string(),
    connected_at: z.string(),
    last_error: z.object({ code: z.string(), at: z.string() }).nullable(),
  })
  .openapi('AdminPublishingTarget');

export const AdminPublishingTargetsResponse = z
  .object({ destinations: z.array(AdminPublishingTarget) })
  .openapi('AdminPublishingTargetsResponse');

export const AdminStaticSitePublishResponse = z
  .object({ commit_sha: z.string(), commit_url: z.string(), path: z.string() })
  .openapi('AdminStaticSitePublishResponse');

export const AdminStaticSitePublishErrorResponse = z
  .object({ error: z.string() })
  .openapi('AdminStaticSitePublishErrorResponse');

// --- Promo codes (design spec 2026-08-29) ---

export const AdminPromoCodeParams = z.object({ promo_code_id: z.string() });

export const AdminPromoCodeCreateBody = z
  .object({
    /** Omit to have the server generate a random 8-char code. */
    code: z
      .string()
      .regex(/^[A-Z0-9]{3,32}$/)
      .optional(),
    name: z.string().trim().min(1).max(200),
    percent: z.number().int().min(1).max(100),
    /** repeating counts months against billing cycles: a 3-month code on a
     * yearly checkout discounts the whole first yearly payment (spec §2). */
    duration: z.enum(PROMO_DURATIONS),
    duration_in_months: z.number().int().min(1).max(120).optional(),
    max_redemptions: z.number().int().min(1).optional(),
    expires_at: z.coerce.date().optional(),
    affiliate: z.string().trim().min(1).max(200).optional(),
  })
  .refine((b) => (b.duration === 'repeating') === (b.duration_in_months !== undefined), {
    message: 'duration_in_months is required iff duration is repeating',
  })
  .openapi('AdminPromoCodeCreateBody');

const AdminPromoCode = z
  .object({
    id: z.string(),
    code: z.string(),
    name: z.string(),
    percent: z.number().int(),
    duration: z.enum(PROMO_DURATIONS),
    duration_in_months: z.number().int().nullable(),
    max_redemptions: z.number().int().nullable(),
    expires_at: z.string().nullable(),
    active: z.boolean(),
    affiliate: z.string().nullable(),
    ls_discount_id: z.string(),
    confirmed_redemptions: z.number().int(),
    created_at: z.string(),
  })
  .openapi('AdminPromoCode');

export const AdminPromoCodeResponse = z
  .object({ promo_code: AdminPromoCode })
  .openapi('AdminPromoCodeResponse');

export const AdminPromoCodesResponse = z
  .object({ promo_codes: z.array(AdminPromoCode) })
  .openapi('AdminPromoCodesResponse');

const AdminPromoRedemption = z
  .object({
    id: z.string(),
    org_id: z.string(),
    status: z.enum(PROMO_REDEMPTION_STATUSES),
    created_at: z.string(),
    confirmed_at: z.string().nullable(),
  })
  .openapi('AdminPromoRedemption');

export const AdminPromoRedemptionsResponse = z
  .object({ redemptions: z.array(AdminPromoRedemption) })
  .openapi('AdminPromoRedemptionsResponse');
