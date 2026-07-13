import { z } from '@hono/zod-openapi';
import { SEARCH_INTENTS } from '@shared/schemas';

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

export const ResearchBody = z
  .object({ org_id: z.string(), seed: z.string().min(1) })
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
