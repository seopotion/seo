import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { adminApi } from '../lib/api';
import { setToken } from '../lib/auth';
import { GOOGLE_CLIENT_ID } from '../lib/env';

/**
 * Operator sign-in. Google proves the identity; the allowlist behind
 * POST /admin/v0/login decides whether that identity is an operator, so a 403
 * here is a real answer ("not an operator"), not a failure to report.
 */
export function LoginPage() {
  const navigate = useNavigate();
  const buttonRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      setError('VITE_GOOGLE_CLIENT_ID is not set — see apps/admin/.env.example.');
      return;
    }

    let cancelled = false;
    let retry: number | undefined;

    const onCredential = async (response: GoogleCredentialResponse) => {
      setError(null);
      setBusy(true);
      try {
        const res = await adminApi.admin.v0.login.$post({
          json: { id_token: response.credential },
        });
        if (res.status === 403) {
          setError('This Google account is not an operator.');
          return;
        }
        if (!res.ok) {
          setError('Sign-in failed. Please try again.');
          return;
        }
        const { token } = await res.json();
        setToken(token);
        navigate('/', { replace: true });
      } catch {
        setError('Sign-in failed. Please try again.');
      } finally {
        setBusy(false);
      }
    };

    // The GIS script is async, so it may not have landed yet when this runs.
    const render = () => {
      if (cancelled || !buttonRef.current) return;
      if (!window.google) {
        retry = window.setTimeout(render, 100);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onCredential,
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
      });
    };
    render();

    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      // GIS appends into the container; clear it so a re-run doesn't stack buttons.
      buttonRef.current?.replaceChildren();
    };
  }, [navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 text-neutral-100">
      <div className="w-80 text-center">
        <h1 className="text-xl font-semibold">SEO Admin</h1>
        <p className="mt-1 text-sm text-neutral-400">Operator sign-in</p>
        <div ref={buttonRef} className="mt-8 flex justify-center" />
        {busy && <p className="mt-4 text-sm text-neutral-400">Signing in…</p>}
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
