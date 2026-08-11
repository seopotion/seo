import type { Article } from '@shared/schemas';
import type { SearchAnalyticsRow } from '../clients/gsc';

/** Analytics range → number of days in one window half (#208). */
export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type AnalyticsRange = keyof typeof RANGE_DAYS;

const DAY_MS = 24 * 60 * 60 * 1000;
/** GSC data lags 2–3 days; ending windows at `today` biases deltas down (#208). */
const GSC_LAG_DAYS = 3;

/** A Date as a GSC yyyy-mm-dd string (UTC). */
export function gscDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface AnalyticsWindows {
  /** Full 2× fetch window: prior start … current end. */
  startDate: string;
  endDate: string;
  /** First date of the current half — rows on/after it are "current". */
  currentStartDate: string;
  priorStartDate: string;
  priorEndDate: string;
}

/**
 * The 2× query window (#208): one GSC call over [priorStart, end] serves both
 * halves — current totals/series and the prior half the deltas compare to.
 */
export function analyticsWindows(range: AnalyticsRange, now = new Date()): AnalyticsWindows {
  const days = RANGE_DAYS[range];
  const end = new Date(now.getTime() - GSC_LAG_DAYS * DAY_MS);
  const currentStart = new Date(end.getTime() - (days - 1) * DAY_MS);
  const priorEnd = new Date(end.getTime() - days * DAY_MS);
  const priorStart = new Date(end.getTime() - (2 * days - 1) * DAY_MS);
  return {
    startDate: gscDate(priorStart),
    endDate: gscDate(end),
    currentStartDate: gscDate(currentStart),
    priorStartDate: gscDate(priorStart),
    priorEndDate: gscDate(priorEnd),
  };
}

export interface MetricTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface MetricDeltas {
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
}

export interface SeriesPoint extends MetricTotals {
  date: string;
}

/**
 * Sum clicks/impressions; ctr and position are impression-weighted — a
 * row-average would let a 10-impression page distort a 10k-impression site.
 */
export function aggregateTotals(rows: SearchAnalyticsRow[]): MetricTotals {
  let clicks = 0;
  let impressions = 0;
  let positionWeight = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    positionWeight += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? positionWeight / impressions : 0,
  };
}

function pct(current: number, prior: number): number | null {
  return prior === 0 ? null : (current - prior) / prior;
}

/**
 * Period-over-period deltas (#208): percent change for clicks/impressions/ctr
 * (null when the prior value is 0), ABSOLUTE change for position — the percent
 * change of a rank is meaningless. Position is null when either half has no
 * impressions (no rank exists to compare).
 */
export function computeDeltas(current: MetricTotals, prior: MetricTotals): MetricDeltas {
  return {
    clicks: pct(current.clicks, prior.clicks),
    impressions: pct(current.impressions, prior.impressions),
    ctr: pct(current.ctr, prior.ctr),
    position:
      prior.impressions === 0 || current.impressions === 0
        ? null
        : current.position - prior.position,
  };
}

/** Split date-keyed rows (keys[0] = yyyy-mm-dd) into current/prior halves. */
export function splitByWindow(
  rows: SearchAnalyticsRow[],
  currentStartDate: string,
): { current: SearchAnalyticsRow[]; prior: SearchAnalyticsRow[] } {
  const current: SearchAnalyticsRow[] = [];
  const prior: SearchAnalyticsRow[] = [];
  for (const r of rows) {
    ((r.keys[0] ?? '') >= currentStartDate ? current : prior).push(r);
  }
  return { current, prior };
}

/** Group date-keyed rows into an ascending daily series (weighted per date). */
export function buildSeries(rows: SearchAnalyticsRow[]): SeriesPoint[] {
  const byDate = new Map<string, SearchAnalyticsRow[]>();
  for (const r of rows) {
    const date = r.keys[0] ?? '';
    const bucket = byDate.get(date);
    if (bucket) bucket.push(r);
    else byDate.set(date, [r]);
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateRows]) => ({ date, ...aggregateTotals(dateRows) }));
}

/** Whole days between publish and now, floored, UTC (#208). */
export function daysLive(publishedAt: Date, now = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - publishedAt.getTime()) / DAY_MS));
}

/** Earliest date the article went live anywhere; null when never published. */
export function articlePublishedAt(a: Pick<Article, 'published_at' | 'publications'>): Date | null {
  const dates = a.publications.map((p) => p.published_at.getTime());
  if (a.published_at) dates.push(a.published_at.getTime());
  return dates.length > 0 ? new Date(Math.min(...dates)) : null;
}

export type Trend = 'up' | 'down' | 'flat';

/**
 * Per-article trend (#208): clicks percent change ≥ +10% → up, ≤ −10% → down,
 * else flat; null when < 14 days live (too noisy) or prior clicks are 0.
 */
export function trendFor(currentClicks: number, priorClicks: number, days: number): Trend | null {
  if (days < 14 || priorClicks === 0) return null;
  const change = (currentClicks - priorClicks) / priorClicks;
  if (change >= 0.1) return 'up';
  if (change <= -0.1) return 'down';
  return 'flat';
}
