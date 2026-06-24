import { hc } from 'hono/client';

// Type-only import of the backend's mounted-router type. Erased at build, so
// the API bundle never pulls in this client (and vice versa). This is the edge
// that gives the frontend end-to-end inference with zero codegen.
import type { AppType } from '../../../../apps/api/src/routes';

/**
 * Typed Hono RPC client for the SEO Dev API.
 *
 * @param url - Public API base URL (e.g. the API Gateway URL).
 * @param getToken - Optional callback returning the current session JWT. When it
 *   returns a token, every request carries `Authorization: Bearer <token>`. The
 *   callback is evaluated per request, so it always reflects the latest token.
 */
export function getApiClient(url: string, getToken?: () => string | null | undefined) {
  return hc<AppType>(url, {
    fetch,
    headers: (): Record<string, string> => {
      const token = getToken?.();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  });
}

export type { AppType as SeoApi };
