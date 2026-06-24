'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { LoginButton } from '../components/LoginButton';
import { api } from '../lib/api';
import { clearToken, getToken } from '../lib/auth';

export default function HomePage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    setAuthed(Boolean(getToken()));
    setChecking(false);
  }, []);

  // After login, the setup_complete gate decides where to land.
  async function routeByStatus() {
    const res = await api.api.v0.core.status.$get();
    if (res.ok) {
      const { setup_complete } = await res.json();
      router.push(setup_complete ? '/dashboard' : '/setup');
    }
  }

  function onLoggedIn() {
    setAuthed(true);
    void routeByStatus();
  }

  function logout() {
    clearToken();
    setAuthed(false);
  }

  if (checking) {
    return (
      <main>
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <main>
      <h1>SEO Dev</h1>
      {authed ? (
        <>
          <button type="button" onClick={() => void routeByStatus()}>
            Continue
          </button>
          <button type="button" onClick={logout}>
            Log out
          </button>
        </>
      ) : (
        <>
          <p>Sign in to continue.</p>
          <LoginButton onLoggedIn={onLoggedIn} />
        </>
      )}
    </main>
  );
}
