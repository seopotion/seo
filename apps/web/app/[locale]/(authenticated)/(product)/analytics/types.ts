import type { InferRequestType, InferResponseType } from 'hono/client';
import type { api } from '@/lib/api';

type AnalyticsApi = typeof api.api.v0.dashboard.analytics;
type SummaryRequest = InferRequestType<AnalyticsApi['summary']['$get']>;

export type AnalyticsRange = NonNullable<SummaryRequest['query']['range']>;
export type AnalyticsScope = NonNullable<SummaryRequest['query']['scope']>;
export type AnalyticsSummary = InferResponseType<AnalyticsApi['summary']['$get'], 200>;
export type AnalyticsArticles = InferResponseType<AnalyticsApi['articles']['$get'], 200>;
export type AnalyticsArticle = AnalyticsArticles['articles'][number];
export type AnalyticsTimeseries = InferResponseType<
  AnalyticsApi['articles'][':id']['timeseries']['$get'],
  200
>;
export type AnalyticsSeriesPoint = AnalyticsSummary['series'][number];
