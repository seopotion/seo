const STORAGE_KEY = 'seo_jwt';

/**
 * Session JWT store. localStorage is the pragmatic fit since the API returns the
 * token in JSON (not a cookie). Note the XSS tradeoff — a hardened setup would
 * use an httpOnly cookie set by the API.
 */
export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setToken(token: string): void {
  if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, token);
}

export function clearToken(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(STORAGE_KEY);
}
