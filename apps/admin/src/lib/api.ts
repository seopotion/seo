import { getAdminApiClient } from '@shared/clients';
import { clearToken, getToken } from './auth';
import { ADMIN_API_URL } from './env';

/**
 * Typed Hono RPC client bound to the admin API. It reads the stored token per
 * request, so every call carries `Authorization: Bearer` as soon as we have
 * one. Change an admin route schema and this app fails to type-check.
 */
export const adminApi = getAdminApiClient(ADMIN_API_URL, getToken);

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

/** Structural shape of a `ClientResponse` — avoids depending on hono directly. */
type JsonResponse<T> = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<T>;
  text: () => Promise<string>;
};

/**
 * The single place an admin API response becomes data or an error. Every query
 * and mutation goes through it, so an expired or invalid session is handled
 * once: drop the token and go back to login.
 */
export async function unwrap<T>(res: JsonResponse<T>): Promise<T> {
  if (res.status === 401) {
    clearToken();
    window.location.assign('/login');
    throw new ApiError('unauthorized', 401);
  }
  if (!res.ok) {
    throw new ApiError(errorCode(await res.text().catch(() => ''), res.statusText), res.status);
  }
  return res.json();
}

/** Admin errors are `{ error: '<code>' }`; anything else falls back to the status text. */
function errorCode(body: string, fallback: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      const { error } = parsed as { error: unknown };
      if (typeof error === 'string') return error;
    }
  } catch {
    // Not JSON (gateway HTML, empty body) — the status text is all we have.
  }
  return fallback;
}
