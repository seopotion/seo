import { z } from 'zod';
import { TOPIC_ROLES } from './candidate';
import { INTEGRATION_PROVIDERS } from './integration';

/** Article lifecycle statuses. */
export const ARTICLE_STATUSES = ['generated', 'published', 'deleted'] as const;

/** Image slot roles + article-level image pipeline states (#51). */
export const ARTICLE_IMAGE_ROLES = ['cover', 'inline'] as const;
export const MAX_MANUAL_ARTICLE_IMAGES = 8;
export const IMAGES_STATUSES = ['pending', 'complete', 'failed'] as const;
export const AUTO_PUBLISH_STATUSES = [
  'queued',
  'publishing',
  'retrying',
  'failed',
  'published',
  'cancelled',
] as const;

/** SEO meta length limits. Here (not @shared/generation) so `apps/web` can
 * import them without pulling the LLM provider clients into the bundle. */
export const META_TITLE_MAX = 60;
export const META_DESCRIPTION_MIN = 120;
export const META_DESCRIPTION_MAX = 160;

/**
 * One planned/generated image slot. `url` is '' until the image is generated
 * and stored (then it's our CloudFront URL); slots are created once by the
 * image plan and filled idempotently — see design/article-images.md.
 */
export const ArticleImageSchema = z.object({
  role: z.enum(ARTICLE_IMAGE_ROLES),
  // null for the cover; the exact H2 text the inline image attaches after.
  section_heading: z.string().nullable(),
  prompt: z.string(),
  alt: z.string(),
  url: z.string(),
  model: z.string().nullable(),
  seed: z.number().nullable(),
  generated_at: z.date().nullable(),
  // Intrinsic pixels of the stored object, as reported by the provider (#176).
  // Nullable like the three above: slots are planned before they are filled, and
  // articles generated before #178 have no dimensions to read.
  width: z.number().nullable().default(null),
  height: z.number().nullable().default(null),
});
export type ArticleImage = z.infer<typeof ArticleImageSchema>;

/**
 * The auto-sourced YouTube embed (#85). Null means no video — toggle off, no
 * relevant result, or the (non-fatal) video step failed.
 */
export const ArticleVideoSchema = z.object({
  video_id: z.string(),
  title: z.string(),
  // Exact H2 text the iframe embed follows in `content`.
  section_heading: z.string(),
});
export type ArticleVideo = z.infer<typeof ArticleVideoSchema>;

/**
 * Where an article currently stands with one publishing target. Replaces
 * `wordpress_post_id`, which cannot express a second provider — and which a
 * static-site publisher could not reuse anyway: there is no post id, and
 * republishing needs to know what slug we last committed under.
 * See design/integrations-model.md § Per-article publish state.
 */
export const ArticlePublicationSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  // The provider's handle on the published object: the WordPress post id as a
  // string, or the commit sha of the last publish for static-site.
  ref: z.string(),
  // The slug this article was ACTUALLY published under — NOT derivable from
  // `slug` below, which the editor can change after publishing.
  slug: z.string(),
  published_at: z.date(),
  updated_at: z.date().nullable(),
  remote_url: z.string().url().nullable().default(null),
});
export type ArticlePublication = z.infer<typeof ArticlePublicationSchema>;

export const PublishingErrorSchema = z.object({
  code: z.string(),
  kind: z.enum(['transient', 'permanent']),
  message: z.string(),
  at: z.date(),
});
export type PublishingError = z.infer<typeof PublishingErrorSchema>;

export const AutoPublishAttemptSchema = z.object({
  provider: z.enum(INTEGRATION_PROVIDERS),
  status: z.enum(AUTO_PUBLISH_STATUSES),
  attempt_count: z.number().int().min(0),
  requested_at: z.date(),
  last_attempt_at: z.date().nullable(),
  lease_expires_at: z.date().nullable(),
  last_error: PublishingErrorSchema.nullable(),
});
export type AutoPublishAttempt = z.infer<typeof AutoPublishAttemptSchema>;

export const AutoPublishStateSchema = z.object({
  preflight_error: PublishingErrorSchema.nullable().default(null),
  attempts: z.array(AutoPublishAttemptSchema).max(INTEGRATION_PROVIDERS.length).default([]),
});
export type AutoPublishState = z.infer<typeof AutoPublishStateSchema>;

/** Readability measured at generation time (#readability gate, 2026-08-28 spec). */
export const ArticleReadabilitySchema = z.object({
  metric: z.literal('flesch_kincaid_grade'),
  grade: z.number().nullable(),
  target: z.number(),
  target_met: z.boolean(),
  /** Humanize passes consumed (1 = passed first try). */
  attempts: z.number().int(),
});
export type ArticleReadability = z.infer<typeof ArticleReadabilitySchema>;

/**
 * Article entity. `title` is the generated SEO title (distinct from `keyword`);
 * `keyword` is denormalized so the Content History table renders without a join.
 * The AI editing layer and `publish_error` are deferred. See design/product-flow.md §2.2.
 */
export const ArticleSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword_id: z.string().nullable(),
  title: z.string(),
  // SERP <title>, distinct from `title` (the H1). Added by generation (#55).
  meta_title: z.string(),
  slug: z.string(),
  keyword: z.string().nullable(),
  topic_cluster_id: z.string().nullable().default(null),
  topic_cluster_label: z.string().nullable().default(null),
  topic_role: z.enum(TOPIC_ROLES).nullable().default(null),
  topic_content_focus: z.string().nullable().default(null),
  topic_primary_keyword: z.string().nullable().default(null),
  meta_description: z.string(),
  featured_image_url: z.string(),
  content: z.string(),
  // null when the provider returned no KD (#304).
  difficulty: z.number().int().nullable(),
  search_volume: z.number().int().nullable(),
  status: z.enum(ARTICLE_STATUSES),
  created_at: z.date(),
  published_at: z.date().nullable(),
  // Per-provider publish state (#7). Defaulted so pre-#7 docs still parse; the
  // `db migrate` backfill seeds it from `wordpress_post_id`.
  publications: z.array(ArticlePublicationSchema).default([]),
  auto_publish: AutoPublishStateSchema.default({ preflight_error: null, attempts: [] }),
  // Deprecated mirror of the `wordpress` entry in `publications`, kept for one
  // release: it is on the wire in ArticleDetailResponse and read by apps/web.
  wordpress_post_id: z.number().int().positive().optional(),
  // Last editor save (#74). Defaulted so pre-#74 docs still parse; null means
  // never edited since generation.
  updated_at: z.date().nullable().default(null),
  // Image pipeline (#51). Defaulted so pre-#51 docs still parse. The future
  // publisher must require images_status === 'complete' before publishing.
  images: z.array(ArticleImageSchema).default([]),
  images_status: z.enum(IMAGES_STATUSES).default('pending'),
  // YouTube embed (#85). Defaulted so pre-#85 docs still parse.
  video: ArticleVideoSchema.nullable().default(null),
  // Readability gate result (2026-08-28 spec). Defaulted so older docs parse.
  readability: ArticleReadabilitySchema.nullable().default(null),
});
export type Article = z.infer<typeof ArticleSchema>;

/** Input for creating an article — the server assigns `id`, `created_at`,
 * `updated_at`, and the publish state (`publications` / `wordpress_post_id`). */
export const CreateArticleInput = ArticleSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
  publications: true,
  auto_publish: true,
  wordpress_post_id: true,
});
// `z.input` (not `z.infer`) so the defaulted image fields stay optional in the
// type, matching the runtime contract — same rationale as `CreateKeywordInput`.
export type CreateArticleInput = z.input<typeof CreateArticleInput>;
