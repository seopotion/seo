import { z } from '@hono/zod-openapi';
import { OrgQuery } from './dashboard';

export { OrgNotFoundResponse } from './dashboard';

/** Analytics page schemas (#208). All GSC-backed reads share the gated flag. */

export const ANALYTICS_RANGES = ['7d', '30d', '90d'] as const;

const RangeParam = z
  .enum(ANALYTICS_RANGES)
  .default('30d')
  .openapi({ param: { name: 'range', in: 'query' } });

export const SummaryQuery = OrgQuery.extend({
  range: RangeParam,
  scope: z
    .enum(['articles', 'site'])
    .default('articles')
    .openapi({ param: { name: 'scope', in: 'query' } }),
});

export const ArticlesAnalyticsQuery = OrgQuery.extend({ range: RangeParam });

// ctr is the raw GSC 0–1 fraction; the frontend formats percents (#208).
export const AnalyticsTotals = z
  .object({
    clicks: z.number(),
    impressions: z.number(),
    ctr: z.number(),
    position: z.number(),
  })
  .openapi('AnalyticsTotals');

// Percent change for clicks/impressions/ctr (null when prior is 0); ABSOLUTE
// change for position (null when either half has no impressions).
export const AnalyticsDeltas = z
  .object({
    clicks: z.number().nullable(),
    impressions: z.number().nullable(),
    ctr: z.number().nullable(),
    position: z.number().nullable(),
  })
  .openapi('AnalyticsDeltas');

export const AnalyticsSeriesPoint = z
  .object({
    date: z.string(),
    clicks: z.number(),
    impressions: z.number(),
    ctr: z.number(),
    position: z.number(),
  })
  .openapi('AnalyticsSeriesPoint');

export const AnalyticsSummaryResponse = z
  .object({
    // Gated until a healthy GSC connection exists; zeros/nulls/empty while gated.
    gated: z.boolean(),
    totals: AnalyticsTotals,
    deltas: AnalyticsDeltas,
    // Current window only, ascending dates; only dates GSC returned.
    series: z.array(AnalyticsSeriesPoint),
  })
  .openapi('AnalyticsSummaryResponse');
