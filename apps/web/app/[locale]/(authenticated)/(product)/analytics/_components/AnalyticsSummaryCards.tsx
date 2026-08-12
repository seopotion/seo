'use client';

import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import {
  type AnalyticsMetric,
  formatCount,
  formatCtr,
  formatDelta,
  formatPosition,
  getDeltaSentiment,
} from '@/lib/analytics';
import { cn } from '@/lib/utils';
import type { AnalyticsSummary } from '../types';

const metrics: AnalyticsMetric[] = ['clicks', 'impressions', 'ctr', 'position'];

export function AnalyticsSummaryCards({ summary }: { summary: AnalyticsSummary }) {
  const t = useTranslations('AnalyticsPage');
  const locale = useLocale();

  return (
    <section aria-label={t('summary.label')} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric) => (
        <Card key={metric} className="gap-4 border-slate-200 py-5 shadow-none">
          <CardHeader className="px-5">
            <CardTitle className="font-medium text-slate-600 text-sm">
              {t(`summary.${metric}`)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between gap-3 px-5">
            <strong className="font-semibold text-3xl text-slate-950 tabular-nums">
              {formatMetric(metric, summary.totals[metric], locale)}
            </strong>
            <DeltaBadge metric={metric} value={summary.deltas[metric]} />
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function DeltaBadge({ metric, value }: { metric: AnalyticsMetric; value: number | null }) {
  const t = useTranslations('AnalyticsPage');
  const locale = useLocale();
  const sentiment = getDeltaSentiment(metric, value);
  const Icon = sentiment === 'positive' ? ArrowUp : sentiment === 'negative' ? ArrowDown : Minus;

  return (
    <Badge
      variant="secondary"
      title={t('summary.deltaComparison')}
      className={cn(
        'border-transparent tabular-nums',
        sentiment === 'positive'
          ? 'bg-emerald-100 text-emerald-700'
          : sentiment === 'negative'
            ? 'bg-rose-100 text-rose-700'
            : 'bg-slate-100 text-slate-600',
      )}
    >
      <Icon className="size-3" aria-hidden="true" />
      {formatDelta(metric, value, locale)}
    </Badge>
  );
}

function formatMetric(metric: AnalyticsMetric, value: number, locale: string): string {
  if (metric === 'ctr') return formatCtr(value, locale);
  if (metric === 'position') return formatPosition(value, locale);
  return formatCount(value, locale);
}
