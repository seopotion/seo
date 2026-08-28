import { afterEach, describe, expect, test, vi } from 'vitest';

const getParameter = vi.hoisted(() => vi.fn());
vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({ getParameter }));

// Only the client constructors are stubbed — `resolveProviderSecret` stays real,
// so these assert the actual env/SSM wiring rather than a mock's behavior.
const createDataForSeoClient = vi.hoisted(() => vi.fn(() => ({ kind: 'dataforseo' })));
const createOpenRouterClient = vi.hoisted(() => vi.fn(() => ({ kind: 'llm' })));
vi.mock('@shared/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/providers')>()),
  createDataForSeoClient,
  createOpenRouterClient,
}));

import { getScanClients } from '../src/providers';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe('worker provider factories', () => {
  test('getScanClients builds clients from plain env vars when no _PARAM is set', async () => {
    delete process.env.DATAFORSEO_LOGIN_PARAM;
    delete process.env.OPENROUTER_API_KEY_PARAM;
    process.env.DATAFORSEO_LOGIN = 'local-login';
    process.env.DATAFORSEO_PASSWORD = 'local-password';
    process.env.OPENROUTER_API_KEY = 'sk-local';

    await getScanClients();

    expect(createDataForSeoClient).toHaveBeenCalledWith({
      login: 'local-login',
      password: 'local-password',
    });
    expect(createOpenRouterClient).toHaveBeenCalledWith({ apiKey: 'sk-local' });
    expect(getParameter).not.toHaveBeenCalled();
  });
});
