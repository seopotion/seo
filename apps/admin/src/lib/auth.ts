// Distinct from the customer app's `seo_jwt` so one browser profile can hold
// both sessions without either clobbering the other.
const STORAGE_KEY = 'seo_admin_jwt';

/**
 * Admin session JWT store. localStorage is the pragmatic fit since the API
 * returns the token in JSON (not a cookie) — same tradeoff as apps/web.
 */
export function getToken(): string | null {
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setToken(token: string): void {
  window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Operator email from the stored token, for display in the header only —
 * never for auth decisions. The signature is not checked here; the API is the
 * only thing that decides whether a token is valid.
 */
export function getOperatorEmail(): string | null {
  const payload = getToken()?.split('.')[1];
  if (!payload) return null;

  try {
    const claims: unknown = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    if (claims && typeof claims === 'object' && 'email' in claims) {
      const { email } = claims as { email: unknown };
      if (typeof email === 'string') return email;
    }
  } catch {
    // Malformed token — treat it as having no displayable identity.
  }
  return null;
}
