import { z } from '@hono/zod-openapi';
import {
  ARTICLE_STATUSES,
  CANDIDATE_STATUSES,
  IMAGES_STATUSES,
  ONBOARDING_INTEGRATIONS,
  REJECTION_REASONS,
  SerpCompetitorSchema,
  SetupPresetsSchema,
  SUBSCRIPTION_STATUSES,
} from '@shared/schemas';
import { ENTITLEMENT_PLANS, SETUP_STATUSES, STRATEGY_STATUSES } from '@shared/types';
// Customer request/response schemas reused directly (single-sourced shapes) —
// these live in apps/api/src/schemas/*, never in route files.
import { CandidateItem, KeywordMetric, ScheduledKeyword } from '../schemas/keywords';
import { SetupPresetsPatchSchema } from '../schemas/setup';

export {
  ArticleDetailResponse,
  ArticleUpdateBody,
  ArticleValidationErrorResponse,
  WordPressArticleErrorResponse,
  WordPressArticleResponse,
} from '../schemas/dashboard';
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
    org_id: z.string(),
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

export const AdminStrategyRunResponse = z
  .object({ strategy_status: z.literal('pending') })
  .openapi('AdminStrategyRunResponse');

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

export const AdminArticlesQuery = z.object({
  status: z.enum(ARTICLE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Customer list row plus images_status + wordpress_post_id (epic #150 DTO spec). */
const AdminArticleListItem = z
  .object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    keyword: z.string(),
    status: z.enum(ARTICLE_STATUSES),
    difficulty: z.number().int(),
    search_volume: z.number().int(),
    featured_image_url: z.string(),
    created_at: z.string(),
    published_at: z.string().nullable(),
    images_status: z.enum(IMAGES_STATUSES),
    wordpress_post_id: z.number().int().nullable(),
  })
  .openapi('AdminArticleListItem');

export const AdminArticlesResponse = z
  .object({ articles: z.array(AdminArticleListItem), total: z.number().int() })
  .openapi('AdminArticlesResponse');
