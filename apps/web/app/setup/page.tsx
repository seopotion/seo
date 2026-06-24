'use client';

import type { SetupStatus } from '@shared/schemas';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { getToken } from '../../lib/auth';

export default function SetupPage() {
  const router = useRouter();
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null);

  // Setup is authenticated; bounce to login if there's no token.
  useEffect(() => {
    if (!getToken()) router.replace('/');
  }, [router]);

  async function startScan() {
    // The client auto-attaches the bearer token. Body/response are fully typed
    // against the backend's AppType.
    const res = await api.api.v0.setup.start_scan.$post({ json: { website_url: websiteUrl } });
    if (res.ok) {
      const data = await res.json();
      setOrgId(data.org_id);
      setStatus(data.setup_status); // typed as SetupStatus
    }
  }

  return (
    <main>
      <h1>Let&apos;s start with your website</h1>
      <input
        type="url"
        placeholder="https://example.com"
        value={websiteUrl}
        onChange={(e) => setWebsiteUrl(e.target.value)}
      />
      <button type="button" onClick={startScan}>
        Continue
      </button>
      {orgId && (
        <p>
          Org {orgId}: {status}
        </p>
      )}
    </main>
  );
}
