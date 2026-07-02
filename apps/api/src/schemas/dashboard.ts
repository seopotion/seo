import { z } from '@hono/zod-openapi';
import { SetupPresetsSchema } from '@shared/schemas';

/**
 * Dashboard Home schemas. These back the four Home-page endpoints in
 * design/product-flow.md (Dashboard §1). The data is mocked/empty for now —
 * a fresh org has nothing published or planned, and the performance blocks
 * stay gated until Google Search Console is connected.
 */

const BestArticle = z
  .object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    clicks: z.number().int(),
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

const ConnectedIntegration = z
  .object({
    id: z.string(),
    provider: z.string(),
    connected_at: z.string(),
  })
  .openapi('ConnectedIntegration');

export const ConnectedIntegrationsResponse = z
  .object({
    integrations: z.array(ConnectedIntegration),
  })
  .openapi('ConnectedIntegrationsResponse');

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
    keyword: z.string(),
    status: z.enum(['scheduled']),
    // ISO date (yyyy-mm-dd) the article is scheduled to generate/publish.
    scheduled_date: z.string(),
    search_volume: z.number().int(),
    difficulty: z.number().int(),
    // null until a keyword has been turned into an article by the (later) worker.
    article_id: z.string().nullable(),
  })
  .openapi('PlannerKeyword');

export const PlannerResponse = z
  .object({
    keywords: z.array(PlannerKeyword),
  })
  .openapi('PlannerResponse');

/**
 * Content History schemas (design/product-flow.md §2.2). Generated/published
 * articles for the active site. The article's SEO title is distinct from the
 * source keyword, so both are stored/returned separately.
 */
const ARTICLE_STATUSES = ['generated', 'published', 'deleted'] as const;

const ArticleListItem = z
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
  })
  .openapi('ArticleListItem');

export const ArticlesQuery = z.object({
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
    title: z.string(),
    slug: z.string(),
    meta_description: z.string(),
    featured_image_url: z.string(),
    content: z.string(),
    status: z.enum(ARTICLE_STATUSES),
    created_at: z.string(),
    published_at: z.string().nullable(),
  })
  .openapi('ArticleDetailResponse');

export const ArticleNotFoundResponse = z
  .object({
    error: z.string().openapi({ example: 'Article not found' }),
  })
  .openapi('ArticleNotFoundResponse');

/**
 * Settings schemas (design/product-flow.md §2.3 + §2.6). Post-onboarding, the
 * scan presets become editable settings. These reuse the SetupPresetsSchema
 * sub-shapes so entity shapes stay single-sourced. GET returns the current
 * values; PATCH deep-merges a partial (same pattern as PATCH /setup/presets).
 */
export const ArticlesSettingsResponse = z
  .object({
    article_preferences: SetupPresetsSchema.shape.article_preferences,
  })
  .openapi('ArticlesSettingsResponse');

export const ArticlesSettingsPatchBody = z
  .object({
    content_seo: SetupPresetsSchema.shape.article_preferences.shape.content_seo
      .partial()
      .optional(),
    engagement: SetupPresetsSchema.shape.article_preferences.shape.engagement.partial().optional(),
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
    business: SetupPresetsSchema.shape.business.partial().optional(),
    audience: SetupPresetsSchema.shape.audience.partial().optional(),
  })
  .openapi('GeneralSettingsPatch');
