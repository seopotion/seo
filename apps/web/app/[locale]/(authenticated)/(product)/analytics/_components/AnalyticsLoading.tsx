export function AnalyticsLoading() {
  return (
    <div className="grid animate-pulse gap-4" aria-hidden="true">
      <div className="h-16 rounded-lg bg-slate-200" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {['clicks', 'impressions', 'ctr', 'position'].map((metric) => (
          <div key={metric} className="h-32 rounded-lg bg-slate-200" />
        ))}
      </div>
      <div className="h-96 rounded-lg bg-slate-200" />
      <div className="h-80 rounded-lg bg-slate-200" />
    </div>
  );
}

export function AnalyticsChartLoading() {
  return <div className="h-80 animate-pulse rounded-md bg-slate-100" aria-hidden="true" />;
}
