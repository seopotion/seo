export const NEEDS_ATTENTION_MIN_IMPRESSIONS = 200;
export const NEEDS_ATTENTION_MAX_CTR = 0.01;
export const NEEDS_ATTENTION_MIN_POSITION = 4;
export const NEEDS_ATTENTION_MAX_POSITION = 10;

export type AnalyticsMetric = 'clicks' | 'impressions' | 'ctr' | 'position';
export type DeltaSentiment = 'positive' | 'negative' | 'neutral';

export type AttentionMetrics = {
  ctr: number;
  impressions: number;
  position: number;
};

const metricFormatOptions = {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
} as const;

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value));
}

export function formatCtr(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    ...metricFormatOptions,
    style: 'percent',
  }).format(value);
}

export function formatPosition(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, metricFormatOptions).format(value);
}

export function formatDelta(metric: AnalyticsMetric, value: number | null, locale: string): string {
  if (value === null) return '—';

  return new Intl.NumberFormat(locale, {
    ...metricFormatOptions,
    signDisplay: 'exceptZero',
    ...(metric === 'position' ? {} : { style: 'percent' as const }),
  }).format(value);
}

export function getDeltaSentiment(metric: AnalyticsMetric, value: number | null): DeltaSentiment {
  if (value === null || value === 0) return 'neutral';

  const improved = metric === 'position' ? value < 0 : value > 0;
  return improved ? 'positive' : 'negative';
}

export function needsAttention(metrics: AttentionMetrics): boolean {
  return (
    metrics.impressions >= NEEDS_ATTENTION_MIN_IMPRESSIONS &&
    metrics.ctr < NEEDS_ATTENTION_MAX_CTR &&
    metrics.position >= NEEDS_ATTENTION_MIN_POSITION &&
    metrics.position <= NEEDS_ATTENTION_MAX_POSITION
  );
}
