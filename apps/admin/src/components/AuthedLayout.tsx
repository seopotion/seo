import { Link, Navigate, Outlet, useNavigate } from 'react-router';
import { clearToken, getOperatorEmail, getToken } from '../lib/auth';

/**
 * The gate every non-login route sits behind: no stored token means no shell,
 * just a bounce to /login. Whether the token is *valid* is the API's call —
 * a rejected request clears it via `unwrap` and lands back here.
 */
export function AuthedLayout() {
  const navigate = useNavigate();

  if (!getToken()) return <Navigate to="/login" replace />;

  const signOut = () => {
    clearToken();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-3">
        <Link to="/" className="font-semibold">
          SeoPotion Admin
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-neutral-400">{getOperatorEmail()}</span>
          <button
            type="button"
            onClick={signOut}
            className="rounded border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
