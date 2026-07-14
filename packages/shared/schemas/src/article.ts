import { z } from 'zod';

/** Article lifecycle statuses. */
export const ARTICLE_STATUSES = ['generated', 'published', 'deleted'] as const;

/** Image slot roles + article-level image pipeline states (#51). */
export const ARTICLE_IMAGE_ROLES = ['cover', 'inline'] as const;
export const IMAGES_STATUSES = ['pending', 'complete', 'failed'] as const;

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
});
export type ArticleImage = z.infer<typeof ArticleImageSchema>;

/**
 * Article entity. `title` is the generated SEO title (distinct from `keyword`);
 * `keyword` is denormalized so the Content History table renders without a join.
 * The AI editing layer and `publish_error` are deferred. See design/product-flow.md §2.2.
 */
export const ArticleSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword_id: z.string(),
  title: z.string(),
  // SERP <title>, distinct from `title` (the H1). Added by generation (#55).
  meta_title: z.string(),
  slug: z.string(),
  keyword: z.string(),
  meta_description: z.string(),
  featured_image_url: z.string(),
  content: z.string(),
  difficulty: z.number().int(),
  search_volume: z.number().int(),
  status: z.enum(ARTICLE_STATUSES),
  created_at: z.date(),
  published_at: z.date().nullable(),
  wordpress_post_id: z.number().int().positive().optional(),
  // Image pipeline (#51). Defaulted so pre-#51 docs still parse. The future
  // publisher must require images_status === 'complete' before publishing.
  images: z.array(ArticleImageSchema).default([]),
  images_status: z.enum(IMAGES_STATUSES).default('pending'),
});
export type Article = z.infer<typeof ArticleSchema>;

/** Input for creating an article — the server assigns `id` and `created_at`. */
export const CreateArticleInput = ArticleSchema.omit({
  id: true,
  created_at: true,
  wordpress_post_id: true,
});
// `z.input` (not `z.infer`) so the defaulted image fields stay optional in the
// type, matching the runtime contract — same rationale as `CreateKeywordInput`.
export type CreateArticleInput = z.input<typeof CreateArticleInput>;
