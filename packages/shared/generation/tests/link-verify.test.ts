import { afterEach, describe, expect, test, vi } from 'vitest';
import { verifyCandidates } from '../src/link-verify';

const candidate = (n: number) => ({ title: `P${n}`, url: `https://a.com/blog/p${n}` });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Stub global fetch with a per-URL status lookup. */
function stubFetch(
  statusByUrl: Record<string, number>,
  onCall?: (url: string, init: RequestInit) => void,
) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    onCall?.(url, init);
    const status = statusByUrl[url] ?? 404;
    return { ok: status >= 200 && status < 300, status } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('verifyCandidates', () => {
  test('keeps 2xx URLs and drops the rest', async () => {
    stubFetch({ 'https://a.com/blog/p1': 200, 'https://a.com/blog/p2': 404 });
    const live = await verifyCandidates([candidate(1), candidate(2)]);
    expect(live).toEqual([candidate(1)]);
  });

  test('retries with GET when HEAD is not allowed', async () => {
    const methods: string[] = [];
    let head = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        methods.push(init.method as string);
        if (head) {
          head = false;
          return { ok: false, status: 405 } as Response;
        }
        return { ok: true, status: 200 } as Response;
      }),
    );
    expect(await verifyCandidates([candidate(1)])).toEqual([candidate(1)]);
    expect(methods).toEqual(['HEAD', 'GET']);
  });

  test('a thrown request (timeout, DNS failure) drops the candidate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ENOTFOUND');
      }),
    );
    expect(await verifyCandidates([candidate(1)])).toEqual([]);
  });

  test('an empty input makes no requests', async () => {
    const fetchMock = stubFetch({});
    expect(await verifyCandidates([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('cancels the response body so the connection is released', async () => {
    const cancel = vi.fn(async () => {});
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, body: { cancel } }) as unknown as Response),
    );
    expect(await verifyCandidates([candidate(1)])).toEqual([candidate(1)]);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('a timed-out request drops the candidate', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        });
      }),
    );
    const result = verifyCandidates([candidate(1)]);
    await vi.advanceTimersByTimeAsync(5_000); // VERIFY_TIMEOUT_MS in src/link-verify.ts
    expect(await result).toEqual([]);
  });
});
