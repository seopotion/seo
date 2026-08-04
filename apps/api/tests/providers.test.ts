import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const getParameter = vi.hoisted(() => vi.fn());
vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({ getParameter }));

// Only the client constructor is stubbed — `resolveProviderSecret` stays real,
// so these assert the actual env/SSM wiring rather than a mock's behavior.
const createDataForSeoClient = vi.hoisted(() => vi.fn(() => ({ kind: 'dataforseo' })));
vi.mock('@shared/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/providers')>()),
  createDataForSeoClient,
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  // The client is memoized at module scope for warm-Lambda reuse, so each test
  // needs a fresh module instance.
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.useRealTimers();
  // resetAllMocks (not clear) so a test's queued `…Once` implementations can't
  // leak into the next one; vi.fn(impl) keeps the implementation it was born with.
  vi.resetAllMocks();
});

describe('getDataForSeoClient', () => {
  test('builds the client from plain env vars when no _PARAM is set', async () => {
    delete process.env.DATAFORSEO_LOGIN_PARAM;
    delete process.env.DATAFORSEO_PASSWORD_PARAM;
    process.env.DATAFORSEO_LOGIN = 'local-login';
    process.env.DATAFORSEO_PASSWORD = 'local-password';

    const { getDataForSeoClient } = await import('../src/clients/providers');
    await getDataForSeoClient();

    expect(createDataForSeoClient).toHaveBeenCalledWith({
      login: 'local-login',
      password: 'local-password',
    });
    expect(getParameter).not.toHaveBeenCalled();
  });

  test('resolves credentials from SSM when _PARAM is set', async () => {
    process.env.DATAFORSEO_LOGIN_PARAM = '/seo/prod/dataforseo-login';
    process.env.DATAFORSEO_PASSWORD_PARAM = '/seo/prod/dataforseo-password';
    getParameter.mockImplementation(async (name: string) => `value-for:${name}`);

    const { getDataForSeoClient } = await import('../src/clients/providers');
    await getDataForSeoClient();

    expect(createDataForSeoClient).toHaveBeenCalledWith({
      login: 'value-for:/seo/prod/dataforseo-login',
      password: 'value-for:/seo/prod/dataforseo-password',
    });
  });

  test('builds the client once and reuses it across calls', async () => {
    process.env.DATAFORSEO_LOGIN_PARAM = '/seo/prod/dataforseo-login';
    process.env.DATAFORSEO_PASSWORD_PARAM = '/seo/prod/dataforseo-password';
    getParameter.mockImplementation(async (name: string) => `value-for:${name}`);

    const { getDataForSeoClient } = await import('../src/clients/providers');
    const first = await getDataForSeoClient();
    const second = await getDataForSeoClient();

    expect(second).toBe(first);
    expect(createDataForSeoClient).toHaveBeenCalledTimes(1);
  });

  test('concurrent first calls share one initialization', async () => {
    process.env.DATAFORSEO_LOGIN_PARAM = '/seo/prod/dataforseo-login';
    process.env.DATAFORSEO_PASSWORD_PARAM = '/seo/prod/dataforseo-password';
    getParameter.mockImplementation(async (name: string) => `value-for:${name}`);

    const { getDataForSeoClient } = await import('../src/clients/providers');
    const [first, second] = await Promise.all([getDataForSeoClient(), getDataForSeoClient()]);

    expect(second).toBe(first);
    expect(createDataForSeoClient).toHaveBeenCalledTimes(1);
    // One resolution per credential, not one per caller.
    expect(getParameter).toHaveBeenCalledTimes(2);
  });

  test('a failed initialization is not cached — the next call retries', async () => {
    process.env.DATAFORSEO_LOGIN_PARAM = '/seo/prod/dataforseo-login';
    process.env.DATAFORSEO_PASSWORD_PARAM = '/seo/prod/dataforseo-password';
    getParameter
      .mockRejectedValueOnce(new Error('ssm unavailable'))
      .mockImplementation(async (name: string) => `value-for:${name}`);

    const { getDataForSeoClient } = await import('../src/clients/providers');
    await expect(getDataForSeoClient()).rejects.toThrow('ssm unavailable');

    const client = await getDataForSeoClient();

    expect(client).toEqual({ kind: 'dataforseo' });
    expect(createDataForSeoClient).toHaveBeenCalledWith({
      login: 'value-for:/seo/prod/dataforseo-login',
      password: 'value-for:/seo/prod/dataforseo-password',
    });
  });

  test('rebuilds the client after the one-hour credential cache expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    process.env.DATAFORSEO_LOGIN_PARAM = '/seo/prod/dataforseo-login';
    process.env.DATAFORSEO_PASSWORD_PARAM = '/seo/prod/dataforseo-password';
    getParameter.mockImplementation(async (name: string) => `value-for:${name}`);

    const { getDataForSeoClient } = await import('../src/clients/providers');
    const first = await getDataForSeoClient();

    vi.setSystemTime(new Date('2026-01-01T01:00:01Z'));
    const second = await getDataForSeoClient();

    expect(second).not.toBe(first);
    expect(createDataForSeoClient).toHaveBeenCalledTimes(2);
    // Powertools gets asked again, so it can refresh its own expired SSM cache.
    expect(getParameter).toHaveBeenCalledTimes(4);
  });
});
