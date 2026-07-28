import { hc } from 'hono/client';

// Type-only import of the admin app's mounted-router type — the exact sibling
// of client.api.ts. Erased at build, so no bundle ever pulls the other side in.
import type { AdminAppType } from '../../../../apps/api/src/admin';

/**
 * Typed Hono RPC client for the SEO Admin API (operator panel, epic #150).
 *
 * @param url - Admin API base URL (the AdminHttpApiUrl CDK output, or
 *   http://localhost:8788 in local dev).
 * @param getToken - Optional callback returning the current admin JWT. When it
 *   returns a token, every request carries `Authorization: Bearer <token>`. The
 *   callback is evaluated per request, so it always reflects the latest token.
 */
export function getAdminApiClient(url: string, getToken?: () => string | null | undefined) {
  return hc<AdminAppType>(url, {
    fetch,
    headers: (): Record<string, string> => {
      const token = getToken?.();
      return token ? { Authorization: `Bearer ${token}` } : {};
    },
  });
}

export type { AdminAppType as SeoAdminApi };
