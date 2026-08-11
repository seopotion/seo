import { z } from '@hono/zod-openapi';
import { OrgQuery } from './dashboard';

export { ArticleNotFoundResponse, ArticleParams, OrgNotFoundResponse, OrgQuery } from './dashboard';

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

export const ArticleAnalyticsRow = z
  .object({
    article_id: z.string(),
    title: z.string(),
    published_at: z.string().nullable(),
    days_live: z.number().int(),
    clicks: z.number(),
    impressions: z.number(),
    ctr: z.number(),
    position: z.number(),
    // Null when < 14 days live or prior-period clicks are 0 (#208).
    trend: z.enum(['up', 'down', 'flat']).nullable(),
    // awaiting: no GSC row yet and published < 4 days (GSC lags 2–3 days);
    // gathering: has data but < 14 days live; ok otherwise (zeros count as ok).
    data_state: z.enum(['ok', 'awaiting', 'gathering']),
  })
  .openapi('ArticleAnalyticsRow');

export const AnalyticsArticlesResponse = z
  .object({
    gated: z.boolean(),
    // Every published article appears; unmatched ones carry zero metrics.
    // Sorting/filtering/pagination are client-side in V1.
    articles: z.array(ArticleAnalyticsRow),
  })
  .openapi('AnalyticsArticlesResponse');

export const AnalyticsTimeseriesResponse = z
  .object({
    gated: z.boolean(),
    // Full-lifetime daily series (publish date → today) for the resolved URL.
    series: z.array(AnalyticsSeriesPoint),
    // Null only when the article has never been published (or while gated).
    days_live: z.number().int().nullable(),
    // not_published: no publications; awaiting: no GSC page row yet (or gated).
    // The 14-day "still gathering" gate is the frontend's, from days_live.
    data_state: z.enum(['ok', 'awaiting', 'not_published']),
  })
  .openapi('AnalyticsTimeseriesResponse');
