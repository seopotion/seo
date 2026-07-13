import { z } from 'zod';

/** Provenance of a candidate keyword. */
export const CANDIDATE_SOURCES = [
  'keywords_for_site',
  'ranked_keywords',
  'keyword_ideas',
  'serp',
  'manual',
  'seed',
] as const;
export type CandidateSource = (typeof CANDIDATE_SOURCES)[number];

/** Candidate lifecycle. Scoring/rejection reasons are added in #54. */
export const CANDIDATE_STATUSES = ['candidate', 'selected', 'rejected'] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/** Search intent, shared with the DataForSEO client's normalization. */
export const SEARCH_INTENTS = [
  'informational',
  'commercial',
  'transactional',
  'navigational',
] as const;
export type SearchIntent = (typeof SEARCH_INTENTS)[number];

/** Constrained article types a classified candidate can become (#54). */
export const ARTICLE_TYPES = [
  'how_to_guide',
  'listicle',
  'comparison',
  'definition',
  'product_guide',
  'case_study',
  'other',
] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

/** Why a candidate was rejected by the pipeline (#54). */
export const REJECTION_REASONS = [
  'brand_navigation',
  'clustered_duplicate',
  'difficulty_ceiling',
  'serp_intent',
  'serp_authority',
  'serp_locality',
  'serp_duplicate',
] as const;
export type RejectionReason = (typeof REJECTION_REASONS)[number];

/** Canonical dedup key: lowercased, trimmed, whitespace-collapsed. */
export function normalizeKeyword(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Candidate keyword — an org-scoped opportunity in the candidate pool, distinct
 * from the scheduled `keywords`/planner collection. Scoring fields
 * (`relevance_score`, `opportunity_score`) are populated later by #54.
 * See docs/superpowers/specs/2026-07-07-dataforseo-candidate-pool-design.md.
 */
export const CandidateSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  keyword: z.string(),
  // Derived from `keyword` by the repository; unique per org.
  normalized_keyword: z.string(),
  source: z.enum(CANDIDATE_SOURCES),
  source_context: z.string().nullable().default(null),
  search_volume: z.number().int().nullable().default(null),
  difficulty: z.number().int().nullable().default(null),
  cpc: z.number().nullable().default(null),
  competition: z.number().nullable().default(null),
  trend: z.number().nullable().default(null),
  intent: z.enum(SEARCH_INTENTS).nullable().default(null),
  // Top-K organic domains captured during SERP validation (#47); null otherwise.
  serp_competitors: z.array(z.string()).nullable().default(null),
  relevance_score: z.number().nullable().default(null),
  opportunity_score: z.number().nullable().default(null),
  article_type: z.enum(ARTICLE_TYPES).nullable().default(null),
  rejection_reason: z.enum(REJECTION_REASONS).nullable().default(null),
  status: z.enum(CANDIDATE_STATUSES).default('candidate'),
  created_at: z.date(),
  updated_at: z.date(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

/**
 * Input for creating a candidate. `id`/`created_at`/`updated_at` are
 * server-assigned; `normalized_keyword` is derived by the repository.
 */
export const CreateCandidateInput = CandidateSchema.omit({
  id: true,
  normalized_keyword: true,
  created_at: true,
  updated_at: true,
});
// `z.input` (not `z.infer`/`z.output`) so defaulted fields (status, scores, etc.)
// are optional in the type, matching the runtime contract: callers pass only
// org_id/keyword/source and the schema fills in the rest on `.parse()`.
export type CreateCandidateInput = z.input<typeof CreateCandidateInput>;
