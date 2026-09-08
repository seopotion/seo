import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useNavigate } from 'react-router';
import { clearToken, getOperatorEmail, getToken } from '../lib/auth';
import { LOCAL_ADMIN_SESSION } from '../lib/env';
import { openLocalAdminSession } from '../lib/local-session';

/**
 * The gate every non-login route sits behind: no stored token means no shell,
 * just a bounce to /login. Whether the token is *valid* is the API's call —
 * a rejected request clears it via `unwrap` and lands back here.
 */
export function AuthedLayout() {
  return LOCAL_ADMIN_SESSION ? <LocalSessionGate /> : <AdminShell />;
}

function LocalSessionGate() {
  const [ready, setReady] = useState(Boolean(getToken()));
  const [error, setError] = useState<string | null>(null);
  const connect = useCallback(async () => {
    setError(null);
    try {
      await openLocalAdminSession();
      setReady(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the local admin session.');
    }
  }, []);

  useEffect(() => {
    if (!ready) void connect();
  }, [ready, connect]);

  if (!ready)
    return (
      <div className="p-8 text-neutral-100">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" className="mt-4 rounded border px-3 py-2" onClick={connect}>
              Retry connection
            </button>
          </>
        ) : (
          <p role="status">Opening local admin…</p>
        )}
      </div>
    );

  return <AdminShell />;
}

function AdminShell() {
  const navigate = useNavigate();
  if (!getToken()) return <Navigate to="/login" replace />;

  const signOut = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <div className="flex items-center gap-6">
          <Link to="/" className="font-semibold">
            SeoPotion Admin
          </Link>
          <nav className="flex items-center gap-4 text-sm text-neutral-400">
            <Link to="/promo-codes" className="hover:text-neutral-100">
              Promo codes
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-400">{getOperatorEmail()}</span>
          {!LOCAL_ADMIN_SESSION && (
            <button
              type="button"
              onClick={signOut}
              className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
            >
              Sign out
            </button>
          )}
        </div>
      </header>
      <main className="px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
