'use client';

import Script from 'next/script';
import { useRef } from 'react';
import { api } from '../lib/api';
import { setToken } from '../lib/auth';

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

/**
 * "Sign in with Google" via Google Identity Services. On success we receive a
 * Google ID token, exchange it at POST /core/login for our session JWT, store
 * it, and notify the parent.
 */
export function LoginButton({ onLoggedIn }: { onLoggedIn: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);

  function initialize() {
    if (!window.google || !containerRef.current) return;

    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: async (response) => {
        const res = await api.api.v0.core.login.$post({ json: { id_token: response.credential } });
        if (res.ok) {
          const { token } = await res.json();
          setToken(token);
          onLoggedIn();
        }
      },
    });

    window.google.accounts.id.renderButton(containerRef.current, {
      theme: 'outline',
      size: 'large',
    });
  }

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onLoad={initialize}
      />
      <div ref={containerRef} />
    </>
  );
}
