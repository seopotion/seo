import { Skeleton } from '@/components/ui';

export function AnalyticsLoading() {
  return (
    <div className="grid gap-4" aria-hidden="true">
      <Skeleton className="h-16 rounded-lg" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['clicks', 'impressions', 'ctr', 'position'].map((metric) => (
          <Skeleton key={metric} className="h-32 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-96 rounded-lg" />
      <Skeleton className="h-80 rounded-lg" />
    </div>
  );
}

export function AnalyticsChartLoading() {
  return <Skeleton className="h-80 bg-muted" aria-hidden="true" />;
}
