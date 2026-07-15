'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { clearToken, getToken } from '../../lib/auth';

type Org = { id: string; website_url: string; name?: string };

type BestArticles = {
  gated: boolean;
  articles: { url: string; clicks: number; title: string | null }[];
};
type SearchPerf = {
  gated: boolean;
  clicks: number | null;
  impressions: number | null;
  ctr: number | null;
  position: number | null;
};

type HomeData = {
  published: number;
  planned: number;
  best: BestArticles;
  perf: SearchPerf;
  integrations: number;
  domainRating: number | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [org, setOrg] = useState<Org | null>(null);
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  // Dashboard is gated behind login; bounce to home if there's no token.
  // Otherwise load the Home endpoints (all typed via AppType — change a
  // route schema in apps/api and this file fails to type-check).
  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    void (async () => {
      // Article counts are org-scoped, so resolve the active org first, then
      // fetch its Home stats. integrations isn't org-scoped yet.
      const orgsRes = await api.api.v0.core.organizations.$get();
      const activeOrg = orgsRes.ok ? ((await orgsRes.json()).organizations[0] ?? null) : null;
      setOrg(activeOrg);

      const [publishedRes, plannedRes, bestRes, perfRes, integrationsRes, domainRatingRes] =
        await Promise.all([
          activeOrg
            ? api.api.v0.dashboard.articles.published.$get({ query: { org_id: activeOrg.id } })
            : null,
          activeOrg
            ? api.api.v0.dashboard.articles.planned.$get({ query: { org_id: activeOrg.id } })
            : null,
          activeOrg
            ? api.api.v0.dashboard.articles.best.$get({ query: { org_id: activeOrg.id } })
            : null,
          activeOrg
            ? api.api.v0.dashboard['search-performance'].$get({ query: { org_id: activeOrg.id } })
            : null,
          api.api.v0.dashboard.integrations.connected.$get(),
          activeOrg
            ? api.api.v0.dashboard['domain-rating'].$get({ query: { org_id: activeOrg.id } })
            : null,
        ]);

      const gatedPerf: SearchPerf = {
        gated: true,
        clicks: null,
        impressions: null,
        ctr: null,
        position: null,
      };
      setData({
        published: publishedRes?.ok ? (await publishedRes.json()).count : 0,
        planned: plannedRes?.ok ? (await plannedRes.json()).count : 0,
        best:
          bestRes?.ok && bestRes.status === 200
            ? await bestRes.json()
            : { gated: true, articles: [] },
        perf: perfRes?.ok && perfRes.status === 200 ? await perfRes.json() : gatedPerf,
        integrations: integrationsRes.ok ? (await integrationsRes.json()).integrations.length : 0,
        domainRating: domainRatingRes?.ok ? (await domainRatingRes.json()).rating : null,
      });
      setLoading(false);
    })();
  }, [router]);

  function logout() {
    clearToken();
    router.replace('/');
  }

  async function connectGsc() {
    if (!org) return;
    const res = await api.api.v0.dashboard.gsc['auth-url'].$get({ query: { org_id: org.id } });
    if (res.ok) window.location.href = (await res.json()).url;
  }

  if (loading) {
    return (
      <main style={{ padding: 24 }}>
        <p>Loading dashboard…</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24, maxWidth: 920, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid #eee',
          paddingBottom: 12,
          marginBottom: 24,
        }}
      >
        <div>
          <strong>{org?.name ?? 'Your organization'}</strong>
          {org?.website_url && (
            <span style={{ color: '#777', marginLeft: 8 }}>{org.website_url}</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={badge}>Domain Rating {data?.domainRating ?? '—'}</span>
          <button type="button" onClick={logout}>
            Log out
          </button>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
        }}
      >
        <section style={card}>
          <h2 style={cardTitle}>Articles</h2>
          <div style={{ display: 'flex', gap: 24 }}>
            <Stat label="Published" value={data?.published ?? 0} />
            <Stat label="Planned" value={data?.planned ?? 0} />
          </div>
          <p style={links}>Visit content planner · Add keywords</p>
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Backlink Exchange</h2>
          <p style={{ color: '#777' }}>Disabled during free trial.</p>
          <button type="button" disabled>
            Upgrade to unlock
          </button>
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Recommended Actions</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>Connect a publishing integration{data?.integrations ? ' ✓' : ''}</li>
            <li>Add keywords to start generating</li>
            <li>Connect Google Search Console</li>
          </ul>
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Best Articles</h2>
          {data?.best.gated ? (
            <>
              <p style={{ color: '#777' }}>Connect Google Search Console to unlock this block.</p>
              <button type="button" onClick={connectGsc}>
                Connect Google Search Console
              </button>
            </>
          ) : data?.best.articles.length ? (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {data.best.articles.map((a) => (
                <li key={a.url}>
                  {a.title ?? a.url} — {a.clicks} clicks
                </li>
              ))}
            </ul>
          ) : (
            <p>No article performance data yet.</p>
          )}
        </section>

        <section style={card}>
          <h2 style={cardTitle}>Search Performance</h2>
          {data?.perf.gated ? (
            <>
              <p style={{ color: '#777' }}>Connect Google Search Console to unlock this block.</p>
              <button type="button" onClick={connectGsc}>
                Connect Google Search Console
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 24 }}>
              <Stat label="Clicks" value={Math.round(data?.perf.clicks ?? 0)} />
              <Stat label="Impressions" value={Math.round(data?.perf.impressions ?? 0)} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div style={{ fontSize: 28, fontWeight: 600 }}>{value}</div>
      <div style={{ color: '#777', fontSize: 13 }}>{label}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #eee',
  borderRadius: 8,
  padding: 16,
};
const cardTitle: React.CSSProperties = { fontSize: 15, margin: '0 0 12px' };
const links: React.CSSProperties = { color: '#0a7', fontSize: 13, marginTop: 12, marginBottom: 0 };
const badge: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 12,
  padding: '2px 10px',
  fontSize: 13,
};
