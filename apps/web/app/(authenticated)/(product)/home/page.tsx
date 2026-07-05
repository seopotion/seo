'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui';
import { api } from '../../../../lib/api';

type HomeData = {
  published: number;
  planned: number;
  bestGated: boolean;
  integrations: number;
};

const emptyHomeData: HomeData = {
  published: 0,
  planned: 0,
  bestGated: true,
  integrations: 0,
};

export default function HomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Dashboard endpoints are typed via AppType. Change a route schema in
  // apps/api and this file fails to type-check.
  useEffect(() => {
    void (async () => {
      try {
        const [publishedRes, plannedRes, bestRes, integrationsRes] = await Promise.all([
          api.api.v0.dashboard.articles.published.$get(),
          api.api.v0.dashboard.articles.planned.$get(),
          api.api.v0.dashboard.articles.best.$get(),
          api.api.v0.dashboard.integrations.connected.$get(),
        ]);

        setData({
          published: publishedRes.ok ? (await publishedRes.json()).count : 0,
          planned: plannedRes.ok ? (await plannedRes.json()).count : 0,
          bestGated: bestRes.ok ? (await bestRes.json()).gated : true,
          integrations: integrationsRes.ok ? (await integrationsRes.json()).integrations.length : 0,
        });
      } catch {
        setData(emptyHomeData);
        setLoadError('Dashboard API is unavailable, so empty development data is shown.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-6 text-slate-600 text-sm">
        Loading home...
      </div>
    );
  }

  return (
    <div>
      {loadError && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 text-sm">
          {loadError}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>Articles</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-8">
              <Stat label="Published" value={data?.published ?? 0} />
              <Stat label="Planned" value={data?.planned ?? 0} />
            </div>
            <p className="mt-4 text-emerald-700 text-sm">Visit content planner / Add keywords</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>Backlink Exchange</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-600 text-sm">Disabled during free trial.</p>
            <button
              type="button"
              disabled
              className="mt-4 rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-400 text-sm"
            >
              Upgrade to unlock
            </button>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>Recommended Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-slate-600 text-sm">
              <li>Connect a publishing integration{data?.integrations ? ' done' : ''}</li>
              <li>Add keywords to start generating</li>
              <li>Connect Google Search Console</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-none">
          <CardHeader>
            <CardTitle>Best Articles</CardTitle>
          </CardHeader>
          <CardContent>
            {data?.bestGated ? (
              <p className="text-slate-600 text-sm">
                Connect Google Search Console to unlock this block.
              </p>
            ) : (
              <p className="text-slate-600 text-sm">No article performance data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="font-semibold text-3xl text-slate-950">{value}</div>
      <div className="mt-1 text-slate-500 text-sm">{label}</div>
    </div>
  );
}
