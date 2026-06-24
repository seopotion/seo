import { getApiClient } from '@shared/clients';
import { getToken } from './auth';

/**
 * Typed Hono RPC client bound to the public API URL. It auto-attaches the stored
 * session JWT (read per request), so authenticated calls just work after login.
 * Change a route schema in apps/api and this app fails to type-check.
 */
export const api = getApiClient(
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787',
  getToken,
);
