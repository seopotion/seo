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
type JsonResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
};

/**
 * The success payload of a typed client response. A route's client type is a
 * *union* of one response per declared status, so picking the `ok: true` member
 * is what turns `Detail | { error: string } | {}` into just `Detail`.
 */
type OkJson<R> = R extends { ok: true; json: () => Promise<infer T> } ? T : never;

/**
 * The single place an admin API response becomes data or an error. Every query
 * and mutation goes through it, so an expired or invalid session is handled
 * once: drop the token and go back to login.
 */
export async function unwrap<R extends JsonResponse>(res: R): Promise<OkJson<R>> {
  if (res.status === 401) {
    clearToken();
    window.location.assign('/login');
    throw new ApiError('unauthorized', 401);
  }
  if (!res.ok) {
    throw new ApiError(errorCode(await res.text().catch(() => ''), res.statusText), res.status);
  }
  // Guarded by the `ok` check above — the runtime body is the success payload
  // that `OkJson` selected, which the `json(): Promise<unknown>` bound hides.
  return res.json() as Promise<OkJson<R>>;
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
