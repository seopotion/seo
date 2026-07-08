import { z } from 'zod';

/** Article lifecycle statuses. */
export const ARTICLE_STATUSES = ['generated', 'published', 'deleted'] as const;

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
});
export type Article = z.infer<typeof ArticleSchema>;

/** Input for creating an article — the server assigns `id` and `created_at`. */
export const CreateArticleInput = ArticleSchema.omit({ id: true, created_at: true });
export type CreateArticleInput = z.infer<typeof CreateArticleInput>;
