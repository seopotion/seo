import { z } from '@hono/zod-openapi';
import {
  ARTICLE_TYPES,
  ArticleVideoSchema,
  AUTO_PUBLISH_STATUSES,
  ContentSeoPatchSchema,
  EngagementPrefsPatchSchema,
  GENERATION_STATUSES,
  IMAGES_STATUSES,
  INTEGRATION_PROVIDERS,
  PublishingPrefsSchema,
  SEARCH_INTENTS,
  SetupPresetsSchema,
} from '@shared/schemas';
import { STRATEGY_STATUSES } from '@shared/types';

// Org-scoped read: the caller passes org_id; the handler checks ownership.
export const OrgQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const OrgNotFoundResponse = z
  .object({ error: z.string().openapi({ example: 'Not found' }) })
  .openapi('DashboardOrgNotFoundResponse');

/**
 * Dashboard Home schemas. These back the four Home-page endpoints in
 * design/product-flow.md (Dashboard §1). The data is mocked/empty for now —
 * a fresh org has nothing published or planned, and the performance blocks
 * stay gated until Google Search Console is connected.
 */

const BestArticle = z
  .object({
    url: z.string(),
    clicks: z.number().int(),
    // Matched against our published articles by slug; null for other site pages.
    title: z.string().nullable(),
  })
  .openapi('BestArticle');

export const BestArticlesResponse = z
  .object({
    articles: z.array(BestArticle),
    // Best articles unlock once live Google Search Console data is connected.
    gated: z.boolean(),
  })
  .openapi('BestArticlesResponse');

export const ArticleCountResponse = z
  .object({
    count: z.number().int(),
  })
  .openapi('ArticleCountResponse');

export const ConnectedIntegration = z
  .object({
    id: z.string(),
    provider: z.enum(INTEGRATION_PROVIDERS),
    // What the settings panel renders after "Connected to": the site URL for
    // WordPress, `owner/repo@branch` for a static site. Opaque to the client.
    target: z.string(),
    connected_at: z.string(),
    // Set when a publish failed for a reason that will still be true next time
    // — uninstalled, suspended, repo dropped from the selection, branch
    // protected. Webhooks are off in v1, so this is the only way the panel
    // learns a connection has died; cleared by the next successful publish.
    last_error: z.object({ code: z.string(), at: z.string() }).nullable(),
  })
  .openapi('ConnectedIntegration');

// Path param for the one disconnect route that replaces per-provider variants.
export const IntegrationProviderParams = z
  .object({
    provider: z
      .enum(INTEGRATION_PROVIDERS)
      .openapi({ param: { name: 'provider', in: 'path' }, example: 'wordpress' }),
  })
  .openapi('IntegrationProviderParams');

export const ConnectedIntegrationsResponse = z
  .object({
    integrations: z.array(ConnectedIntegration),
  })
  .openapi('ConnectedIntegrationsResponse');

export const WordPressConnectionBody = z
  .object({
    org_id: z.string(),
    token: z.string().min(1),
  })
  .openapi('WordPressConnectionBody');

export const WordPressConnectionResponse = z
  .object({ success: z.literal(true) })
  .openapi('WordPressConnectionResponse');

export const WordPressConnectionErrorResponse = z
  .object({
    success: z.literal(false),
    error_code: z.string(),
  })
  .openapi('WordPressConnectionErrorResponse');

export const SearchPerformanceResponse = z
  .object({
    // Gated until a healthy GSC connection exists; metrics are 28-day totals.
    gated: z.boolean(),
    clicks: z.number().nullable(),
    impressions: z.number().nullable(),
    ctr: z.number().nullable(),
    position: z.number().nullable(),
  })
  .openapi('SearchPerformanceResponse');

export const DomainRatingResponse = z
  .object({
    // 0–100 badge value; null when the org was never rated and the provider is
    // unavailable.
    rating: z.number().int().min(0).max(100).nullable(),
  })
  .openapi('DomainRatingResponse');

/**
 * Content Planner schemas (design/product-flow.md §2.1). The monthly calendar
 * is a list of scheduled keywords; each card's affordance depends on whether an
 * article has been generated for it yet (`article_id` null → Pre-Create,
 * set → Visit Article). Baseline stores the bare keyword + volume/difficulty;
 * the richer classification / quality-questions fields are deferred (G10/G11).
 */
const PlannerKeyword = z
  .object({
    id: z.string(),
    // Source candidate linkage (#99); null for legacy records.
    candidate_id: z.string().nullable(),
    keyword: z.string(),
    status: z.enum(['scheduled']),
    // ISO date (yyyy-mm-dd) the article is scheduled to generate/publish.
    scheduled_date: z.string(),
    search_volume: z.number().int(),
    difficulty: z.number().int().nullable(),
    // Classification from the candidate/strategy pipeline; null for older entries.
    article_type: z.enum(ARTICLE_TYPES).nullable(),
    intent: z.enum(SEARCH_INTENTS).nullable(),
    opportunity_score: z.number().nullable(),
    // Generation lifecycle (#55): the keyword is the provisional display title
    // until article_id is populated by the generation worker.
    generation_status: z.enum(GENERATION_STATUSES),
    generation_error: z.string().nullable(),
    // null until a keyword has been turned into an article by the (later) worker.
    article_id: z.string().nullable(),
  })
  .openapi('PlannerKeyword');

export const PlannerResponse = z
  .object({
    // Automatic-strategy job state (#47) so the planner can show the plan as
    // pending / completed / failed; 'none' for orgs that never ran a paid job.
    strategy_status: z.enum(STRATEGY_STATUSES).openapi({ example: 'completed' }),
    keywords: z.array(PlannerKeyword),
  })
  .openapi('PlannerResponse');

/**
 * Content History schemas (design/product-flow.md §2.2). Generated/published
 * articles for the active site. The article's SEO title is distinct from the
 * source keyword, so both are stored/returned separately.
 */
const ARTICLE_STATUSES = ['generated', 'published', 'deleted'] as const;

const PublishingErrorResponse = z.object({
  code: z.string(),
  kind: z.enum(['transient', 'permanent']),
  message: z.string(),
  at: z.string(),
});

const ArticlePublicationResponse = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  ref: z.string(),
  slug: z.string(),
  remote_url: z.string().nullable(),
  published_at: z.string(),
  updated_at: z.string().nullable(),
});

const AutoPublishAttemptResponse = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  status: z.enum(AUTO_PUBLISH_STATUSES),
  attempt_count: z.number().int().min(0),
  requested_at: z.string(),
  last_attempt_at: z.string().nullable(),
  last_error: PublishingErrorResponse.nullable(),
});

const ArticleListItem = z
  .object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    keyword: z.string(),
    status: z.enum(ARTICLE_STATUSES),
    difficulty: z.number().int().nullable(),
    search_volume: z.number().int(),
    featured_image_url: z.string(),
    created_at: z.string(),
    published_at: z.string().nullable(),
    publications: z.array(ArticlePublicationResponse),
    auto_publish_error: PublishingErrorResponse.nullable(),
    auto_publish_attempts: z.array(AutoPublishAttemptResponse),
  })
  .openapi('ArticleListItem');

export const ArticlesQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
  status: z
    .enum(ARTICLE_STATUSES)
    .optional()
    .openapi({ param: { name: 'status', in: 'query' }, example: 'published' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .openapi({ param: { name: 'limit', in: 'query' }, example: 20 }),
  offset: z.coerce
    .number()
    .int()
    .min(0)
    .default(0)
    .openapi({ param: { name: 'offset', in: 'query' }, example: 0 }),
});

export const ArticlesResponse = z
  .object({
    articles: z.array(ArticleListItem),
    total: z.number().int(),
  })
  .openapi('ArticlesResponse');

export const ArticleParams = z.object({
  id: z.string().openapi({ param: { name: 'id', in: 'path' }, example: 'art_1' }),
});

// Full article record — the generated-article surface (§2.2.1). The AI editing
// layer (chat rewrite, per-block regen, inline media) is a deferred subsystem;
// baseline stores title/meta/slug/body as markdown.
export const ArticleDetailResponse = z
  .object({
    id: z.string(),
    keyword_id: z.string(),
    // Denormalized keyword + SERP <title>; both drive the editor modal (#74).
    keyword: z.string(),
    title: z.string(),
    meta_title: z.string(),
    slug: z.string(),
    meta_description: z.string(),
    featured_image_url: z.string(),
    content: z.string(),
    status: z.enum(ARTICLE_STATUSES),
    wordpress_post_id: z.number().int().positive().optional(),
    // First static-site publish, ISO; null until then. The counterpart of
    // `wordpress_post_id` for the git target — publish and update are one route,
    // so the UI needs this only to label the button and badge the article.
    static_site_published_at: z.string().nullable(),
    publications: z.array(ArticlePublicationResponse),
    auto_publish_error: PublishingErrorResponse.nullable(),
    auto_publish_attempts: z.array(AutoPublishAttemptResponse),
    images_status: z.enum(IMAGES_STATUSES),
    created_at: z.string(),
    // Last editor save, ISO; null until the article is first edited (#74).
    updated_at: z.string().nullable(),
    published_at: z.string().nullable(),
    // Auto-sourced YouTube embed (#85); the iframe is also in `content`.
    video: ArticleVideoSchema.nullable(),
  })
  .openapi('ArticleDetailResponse');

export const ArticleNotFoundResponse = z
  .object({
    error: z.string().openapi({ example: 'Article not found' }),
  })
  .openapi('ArticleNotFoundResponse');

export const WordPressArticleResponse = z
  .object({
    success: z.literal(true),
    post_id: z.number().int().positive(),
    slug: z.string().optional(),
    permalink: z.string().optional(),
    post_status: z.string().optional(),
    warnings: z.array(z.string()).optional(),
  })
  .openapi('WordPressArticleResponse');

export const WordPressArticleErrorResponse = z
  .object({ error: z.string() })
  .openapi('WordPressArticleErrorResponse');

// Static-site publish (#7, design/static-site-integration.md). One commit
// carrying the article's Markdown and the rebuilt manifest, so there is exactly
// one sha to report — and it is what `publications[].ref` records.
export const StaticSitePublishResponse = z
  .object({
    commit_sha: z.string(),
    // Deep link for a "view the commit" affordance; GitHub is the only host today.
    commit_url: z.string(),
    // Repo-root-relative path of the committed Markdown file.
    path: z.string(),
  })
  .openapi('StaticSitePublishResponse');

export const StaticSitePublishErrorResponse = z
  .object({ error: z.string(), code: z.string() })
  .openapi('StaticSitePublishErrorResponse');

export const AutoPublishRetryResponse = z
  .object({ queued: z.array(z.enum(INTEGRATION_PROVIDERS)) })
  .openapi('AutoPublishRetryResponse');

export const AutoPublishRetryErrorResponse = z
  .object({ error: z.string(), code: z.string() })
  .openapi('AutoPublishRetryErrorResponse');

// The editor's five editable fields. Deliberately permissive here: `apps/api`
// has no `defaultHook`, so a Zod failure would return the library's error shape
// instead of the { error, fields } contract. The handler validates and builds
// that response itself (#74).
export const ArticleUpdateBody = z
  .object({
    title: z.string(),
    slug: z.string(),
    meta_title: z.string(),
    meta_description: z.string(),
    content: z.string(),
  })
  .openapi('ArticleUpdate');

export const ArticleValidationErrorResponse = z
  .object({
    error: z.string().openapi({ example: 'Validation failed' }),
    // Field name -> message, for the offending fields only.
    fields: z.record(z.string(), z.string()),
  })
  .openapi('ArticleValidationError');

/**
 * Settings schemas (design/product-flow.md §2.3 + §2.6). Post-onboarding, the
 * scan presets become editable settings. These reuse the SetupPresetsSchema
 * sub-shapes so entity shapes stay single-sourced. GET returns the current
 * values; PATCH deep-merges a partial (same pattern as PATCH /setup/presets).
 */
// Settings are org-scoped: GET carries `org_id` as a query param, PATCH in the
// body (same convention as the setup routes). Ownership is checked server-side.
export const SettingsQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const SettingsNotFoundResponse = z
  .object({
    error: z.string().openapi({ example: 'Settings not available' }),
  })
  .openapi('SettingsNotFoundResponse');

export const ArticlesSettingsResponse = z
  .object({
    article_preferences: SetupPresetsSchema.shape.article_preferences,
  })
  .openapi('ArticlesSettingsResponse');

export const ArticlesSettingsPatchBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    content_seo: ContentSeoPatchSchema.optional(),
    engagement: EngagementPrefsPatchSchema.optional(),
    publishing: PublishingPrefsSchema.partial().optional(),
  })
  .openapi('ArticlesSettingsPatch');

export const GeneralSettingsResponse = z
  .object({
    business: SetupPresetsSchema.shape.business,
    audience: SetupPresetsSchema.shape.audience,
  })
  .openapi('GeneralSettingsResponse');

export const GeneralSettingsPatchBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    business: SetupPresetsSchema.shape.business.partial().optional(),
    audience: SetupPresetsSchema.shape.audience.partial().optional(),
  })
  .openapi('GeneralSettingsPatch');
