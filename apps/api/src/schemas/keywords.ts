import { z } from '@hono/zod-openapi';
import {
  ARTICLE_TYPES,
  CANDIDATE_SOURCES,
  CANDIDATE_STATUSES,
  GENERATION_STATUSES,
  SEARCH_INTENTS,
} from '@shared/schemas';

export const KeywordMetric = z
  .object({
    keyword: z.string(),
    search_volume: z.number().int().nullable(),
    difficulty: z.number().int().nullable(),
    cpc: z.number().nullable(),
    competition: z.number().nullable(),
    trend: z.number().nullable(),
    intent: z.enum(SEARCH_INTENTS).nullable(),
  })
  .openapi('KeywordMetric');
export type KeywordMetric = z.infer<typeof KeywordMetric>;

// Seed is trimmed server-side; whitespace-only or oversized seeds are rejected
// before any paid provider call (#99).
export const ResearchBody = z
  .object({ org_id: z.string(), seed: z.string().trim().min(1).max(200) })
  .openapi('ResearchBody');

export const ResearchResponse = z
  .object({ seed: KeywordMetric, similar: z.array(KeywordMetric) })
  .openapi('ResearchResponse');

export const SelectBody = z
  .object({ org_id: z.string(), keywords: z.array(KeywordMetric).min(1) })
  .openapi('SelectBody');

export const SelectResponse = z
  .object({ added: z.number().int(), skipped: z.number().int() })
  .openapi('SelectResponse');

export const ErrorResponse = z.object({ error: z.string() }).openapi('KeywordsError');

/** Strict date-only value that is also a real calendar date (UTC). */
function isValidDateOnly(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const DateOnly = z
  .string()
  .refine(isValidDateOnly, { message: 'must be a valid yyyy-mm-dd date' })
  .openapi({ example: '2026-07-20' });

// --- Candidate pool read (#99) ---

export const CandidatesQuery = z
  .object({
    org_id: z.string().openapi({ param: { name: 'org_id', in: 'query' } }),
    status: z.enum(CANDIDATE_STATUSES).default('candidate'),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .openapi('CandidatesQuery');

export const CandidateItem = z
  .object({
    id: z.string(),
    keyword: z.string(),
    search_volume: z.number().int().nullable(),
    difficulty: z.number().int().nullable(),
    cpc: z.number().nullable(),
    competition: z.number().nullable(),
    trend: z.number().nullable(),
    intent: z.enum(SEARCH_INTENTS).nullable(),
    article_type: z.enum(ARTICLE_TYPES).nullable(),
    relevance_score: z.number().nullable(),
    opportunity_score: z.number().nullable(),
    source: z.enum(CANDIDATE_SOURCES),
    status: z.enum(CANDIDATE_STATUSES),
    // False while KeywordSchema-required metrics are missing — the frontend
    // disables the scheduling action but may still show the row.
    schedulable: z.boolean(),
    created_at: z.string(),
  })
  .openapi('CandidateItem');

export const CandidatesResponse = z
  .object({
    candidates: z.array(CandidateItem),
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  })
  .openapi('CandidatesResponse');

// --- Candidate scheduling + planner mutations (#99) ---

export const ScheduleParams = z.object({
  candidate_id: z.string().openapi({ param: { name: 'candidate_id', in: 'path' } }),
});

export const CandidateParams = z.object({
  candidate_id: z.string().openapi({ param: { name: 'candidate_id', in: 'path' } }),
});

export const ScheduledKeywordParams = z.object({
  keyword_id: z.string().openapi({ param: { name: 'keyword_id', in: 'path' } }),
});

export const ScheduleBody = z.object({ scheduled_date: DateOnly }).openapi('ScheduleBody');

export const ScheduledKeyword = z
  .object({
    id: z.string(),
    candidate_id: z.string().nullable(),
    keyword: z.string(),
    status: z.enum(['scheduled']),
    scheduled_date: z.string(),
    search_volume: z.number().int(),
    difficulty: z.number().int(),
    article_type: z.enum(ARTICLE_TYPES).nullable(),
    intent: z.enum(SEARCH_INTENTS).nullable(),
    opportunity_score: z.number().nullable(),
    generation_status: z.enum(GENERATION_STATUSES),
    generation_error: z.string().nullable(),
    article_id: z.string().nullable(),
  })
  .openapi('ScheduledKeyword');

export const ScheduledKeywordResponse = z
  .object({ keyword: ScheduledKeyword })
  .openapi('ScheduledKeywordResponse');
