import { z } from 'zod';
import { ARTICLE_TYPES, SEARCH_INTENTS, SerpCompetitorsField, TOPIC_ROLES } from './candidate';

/** Keyword statuses. Only `scheduled` today; the enum leaves room to grow. */
export const KEYWORD_STATUSES = ['scheduled'] as const;

/** Generation lifecycle for a scheduled keyword (#55). */
export const GENERATION_STATUSES = ['pending', 'generating', 'generated', 'failed'] as const;

/**
 * Keyword entity — one org-scoped record per planner (calendar) opportunity.
 * `id` is the stringified Mongo `_id`. Rich classification / quality-questions
 * / provenance fields are deferred (parity-gaps G10/G11). See design/product-flow.md §2.1.
 */
export const KeywordSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  // Source candidate-pool linkage (#99); null for legacy / pre-#99 records.
  candidate_id: z.string().nullable().default(null),
  keyword: z.string(),
  // Derived from `keyword` by the repository; optional so pre-existing docs still parse.
  normalized_keyword: z.string().optional(),
  status: z.enum(KEYWORD_STATUSES),
  // Date-only (yyyy-mm-dd) the article is scheduled to generate/publish.
  scheduled_date: z.string(),
  search_volume: z.number().int(),
  // null when the provider returned no KD (#304); search_volume stays required.
  difficulty: z.number().int().nullable(),
  // null until article generation links an article back to the keyword.
  article_id: z.string().nullable(),
  // Planner brief (populated by the #47 strategy job; null for older/manual entries).
  article_type: z.enum(ARTICLE_TYPES).nullable().default(null),
  intent: z.enum(SEARCH_INTENTS).nullable().default(null),
  opportunity_score: z.number().nullable().default(null),
  serp_competitors: SerpCompetitorsField,
  topic_cluster_id: z.string().nullable().default(null),
  topic_cluster_label: z.string().nullable().default(null),
  topic_role: z.enum(TOPIC_ROLES).nullable().default(null),
  topic_content_focus: z.string().nullable().default(null),
  topic_primary_keyword: z.string().nullable().default(null),
  created_at: z.date(),
  // Generation lifecycle (#55). Defaulted so pre-#55 planner docs still parse.
  generation_status: z.enum(GENERATION_STATUSES).default('pending'),
  generation_attempts: z.number().int().default(0),
  generation_error: z.string().nullable().default(null),
  generation_started_at: z.date().nullable().default(null),
});
export type Keyword = z.infer<typeof KeywordSchema>;

/** Input for creating a keyword — the server assigns `id`/`created_at`; the repo derives `normalized_keyword`. */
export const CreateKeywordInput = KeywordSchema.omit({
  id: true,
  normalized_keyword: true,
  created_at: true,
});
// `z.input` (not `z.infer`/`z.output`) so the defaulted brief fields (article_type,
// intent, opportunity_score, serp_competitors) stay optional in the type, matching
// the runtime contract — see the same rationale on `CreateCandidateInput`.
export type CreateKeywordInput = z.input<typeof CreateKeywordInput>;
