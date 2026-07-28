import { afterEach, describe, expect, test, vi } from 'vitest';
import { ApiError, unwrap } from '../src/lib/api';

// `unwrap` is the one place a dead session is detected, so it gets a test even
// though nothing calls it until org search lands. No jsdom — the two browser
// globals it touches are stubbed directly.
function stubWindow() {
  const store = new Map<string, string>([['seo_admin_jwt', 'stale.token.value']]);
  const assign = vi.fn();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    },
    location: { assign },
  });
  return { assign, store };
}

function response(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Status Text',
    json: async () => JSON.parse(body),
    text: async () => body,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('unwrap', () => {
  test('returns the parsed body on success', async () => {
    stubWindow();
    await expect(unwrap(response(200, '{"token":"abc"}'))).resolves.toEqual({ token: 'abc' });
  });

  test('401 clears the token and returns to login', async () => {
    const { assign, store } = stubWindow();
    await expect(unwrap(response(401, '{"error":"unauthorized"}'))).rejects.toBeInstanceOf(
      ApiError,
    );
    expect(store.has('seo_admin_jwt')).toBe(false);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  test('other failures carry the API error code and keep the session', async () => {
    const { assign, store } = stubWindow();
    await expect(unwrap(response(403, '{"error":"not_an_operator"}'))).rejects.toMatchObject({
      code: 'not_an_operator',
      status: 403,
    });
    expect(store.has('seo_admin_jwt')).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });

  test('falls back to the status text when the body is not JSON', async () => {
    stubWindow();
    await expect(unwrap(response(502, '<html>Bad Gateway</html>'))).rejects.toMatchObject({
      code: 'Status Text',
    });
  });
});
