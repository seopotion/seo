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
  vi.clearAllMocks();
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
});
