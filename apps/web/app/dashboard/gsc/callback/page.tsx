'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { getToken } from '../../../../lib/auth';

type Site = { site_url: string; permission_level: string };

/**
 * GSC OAuth callback (#12). Google redirects here with ?code&state; we exchange
 * the code server-side, then the user picks which GSC property backs this org.
 */
function CallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) {
      setError('Google connection was cancelled or failed.');
      return;
    }
    void (async () => {
      const res = await api.api.v0.dashboard.gsc.connect.$post({ json: { code, state } });
      if (!res.ok) {
        setError('Could not complete the Google connection. Please try again.');
        return;
      }
      const body = await res.json();
      setOrgId(body.org_id);
      setSites(body.sites);
    })();
  }, [params, router]);

  async function pick(site_url: string) {
    if (!orgId) return;
    setSaving(true);
    const res = await api.api.v0.dashboard.gsc.site.$post({ json: { org_id: orgId, site_url } });
    if (res.ok) {
      router.replace('/dashboard');
    } else {
      setSaving(false);
      setError('Could not select that property. Please try again.');
    }
  }

  return (
    <main style={{ padding: 24, maxWidth: 560, margin: '0 auto' }}>
      <h1 style={{ fontSize: 18 }}>Connect Google Search Console</h1>
      {error && (
        <>
          <p style={{ color: '#c00' }}>{error}</p>
          <button type="button" onClick={() => router.replace('/dashboard')}>
            Back to dashboard
          </button>
        </>
      )}
      {!error && !sites && <p>Completing the Google connection…</p>}
      {!error && sites && sites.length === 0 && (
        <>
          <p>This Google account has no Search Console properties.</p>
          <button type="button" onClick={() => router.replace('/dashboard')}>
            Back to dashboard
          </button>
        </>
      )}
      {!error && sites && sites.length > 0 && (
        <>
          <p>Choose the property for this site:</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {sites.map((s) => (
              <li key={s.site_url} style={{ marginBottom: 8 }}>
                <button type="button" disabled={saving} onClick={() => pick(s.site_url)}>
                  {s.site_url}
                </button>
                <span style={{ color: '#777', marginLeft: 8, fontSize: 13 }}>
                  {s.permission_level}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

// useSearchParams requires a Suspense boundary in the app router.
export default function GscCallbackPage() {
  return (
    <Suspense fallback={<p style={{ padding: 24 }}>Loading…</p>}>
      <CallbackInner />
    </Suspense>
  );
}
