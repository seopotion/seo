import { z } from 'zod';

/** Keyword statuses. Only `scheduled` today; the enum leaves room to grow. */
export const KEYWORD_STATUSES = ['scheduled'] as const;

/**
 * Keyword entity — one org-scoped record per planner (calendar) opportunity.
 * `id` is the stringified Mongo `_id`. Rich classification / quality-questions
 * / provenance fields are deferred (parity-gaps G10/G11). See design/product-flow.md §2.1.
 */
export const KeywordSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword: z.string(),
  status: z.enum(KEYWORD_STATUSES),
  // Date-only (yyyy-mm-dd) the article is scheduled to generate/publish.
  scheduled_date: z.string(),
  search_volume: z.number().int(),
  difficulty: z.number().int(),
  // null until article generation links an article back to the keyword.
  article_id: z.string().nullable(),
  created_at: z.date(),
});
export type Keyword = z.infer<typeof KeywordSchema>;

/** Input for creating a keyword — the server assigns `id` and `created_at`. */
export const CreateKeywordInput = KeywordSchema.omit({ id: true, created_at: true });
export type CreateKeywordInput = z.infer<typeof CreateKeywordInput>;
