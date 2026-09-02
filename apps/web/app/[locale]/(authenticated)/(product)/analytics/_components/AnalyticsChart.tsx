'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button } from '@/components/ui';
import { formatCount, formatCtr, formatPosition } from '@/lib/analytics';
import type { AnalyticsSeriesPoint } from '../types';

type ChartMode = 'traffic' | 'searchMetrics';

export default function AnalyticsChart({
  allowMetricToggle = false,
  series,
}: {
  allowMetricToggle?: boolean;
  series: AnalyticsSeriesPoint[];
}) {
  const t = useTranslations('AnalyticsPage');
  const locale = useLocale();
  const [mode, setMode] = useState<ChartMode>('traffic');
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }),
    [locale],
  );

  if (series.length === 0) {
    return (
      <div className="grid h-80 place-items-center rounded-md bg-muted/50 px-4 text-center text-muted-foreground text-sm">
        {t('chart.empty')}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {allowMetricToggle ? (
        <div className="flex w-fit rounded-md border border-border bg-muted/50 p-1">
          {(['traffic', 'searchMetrics'] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={mode === option ? 'secondary' : 'ghost'}
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
            >
              {t(`chart.modes.${option}`)}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="h-80 w-full" role="img" aria-label={t('chart.label')}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={series} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatDate(value, dateFormatter)}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
              tickLine={false}
              axisLine={{ stroke: 'var(--border)' }}
              minTickGap={24}
            />
            {mode === 'traffic' ? (
              <>
                <YAxis
                  yAxisId="clicks"
                  tickFormatter={(value: number) => formatCompact(value, locale)}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                />
                <YAxis
                  yAxisId="impressions"
                  orientation="right"
                  tickFormatter={(value: number) => formatCompact(value, locale)}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                />
                <Area
                  yAxisId="clicks"
                  type="monotone"
                  dataKey="clicks"
                  name={t('summary.clicks')}
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  fillOpacity={0.15}
                  strokeWidth={2}
                />
                <Line
                  yAxisId="impressions"
                  type="monotone"
                  dataKey="impressions"
                  name={t('summary.impressions')}
                  stroke="var(--chart-2)"
                  strokeWidth={2}
                  dot={false}
                />
              </>
            ) : (
              <>
                <YAxis
                  yAxisId="ctr"
                  tickFormatter={(value: number) => formatCtr(value, locale)}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={54}
                />
                <YAxis
                  yAxisId="position"
                  orientation="right"
                  tickFormatter={(value: number) => formatPosition(value, locale)}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  width={46}
                />
                <Line
                  yAxisId="ctr"
                  type="monotone"
                  dataKey="ctr"
                  name={t('summary.ctr')}
                  stroke="var(--chart-1)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  yAxisId="position"
                  type="monotone"
                  dataKey="position"
                  name={t('summary.position')}
                  stroke="var(--chart-3)"
                  strokeWidth={2}
                  dot={false}
                />
              </>
            )}
            <Tooltip
              labelFormatter={(label) => formatDate(String(label), dateFormatter)}
              formatter={(value, name) => [
                formatTooltipValue(String(name), Number(value), locale, t),
                name,
              ]}
              contentStyle={{
                backgroundColor: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                boxShadow: '0 8px 24px oklch(0 0 0 / 0.16)',
                color: 'var(--popover-foreground)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function formatTooltipValue(
  name: string,
  value: number,
  locale: string,
  t: ReturnType<typeof useTranslations<'AnalyticsPage'>>,
): string {
  if (name === t('summary.ctr')) return formatCtr(value, locale);
  if (name === t('summary.position')) return formatPosition(value, locale);
  return formatCount(value, locale);
}

function formatDate(value: string, formatter: Intl.DateTimeFormat): string {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : formatter.format(date);
}

function formatCompact(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}
