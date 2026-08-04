import { afterEach, describe, expect, test, vi } from 'vitest';

const getParameter = vi.hoisted(() => vi.fn());
vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({ getParameter }));

// Only the client constructors are stubbed — `resolveProviderSecret` stays real,
// so these assert the actual env/SSM wiring rather than a mock's behavior.
const createDataForSeoClient = vi.hoisted(() => vi.fn(() => ({ kind: 'dataforseo' })));
const createOpenRouterClient = vi.hoisted(() => vi.fn(() => ({ kind: 'llm' })));
const createYouTubeClient = vi.hoisted(() => vi.fn(() => ({ kind: 'youtube' })));
const createFalClient = vi.hoisted(() => vi.fn(() => ({ kind: 'image' })));
vi.mock('@shared/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/providers')>()),
  createDataForSeoClient,
  createOpenRouterClient,
  createYouTubeClient,
  createFalClient,
}));

import {
  getGenerationClients,
  getImageClients,
  getScanClients,
  getStrategyClients,
} from '../src/providers';

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

  test('getStrategyClients resolves credentials from SSM when _PARAM is set', async () => {
    process.env.DATAFORSEO_LOGIN_PARAM = '/seo/prod/dataforseo-login';
    process.env.DATAFORSEO_PASSWORD_PARAM = '/seo/prod/dataforseo-password';
    process.env.OPENROUTER_API_KEY_PARAM = '/seo/prod/openrouter-api-key';
    getParameter.mockImplementation(async (name: string) => `value-for:${name}`);

    await getStrategyClients();

    expect(createDataForSeoClient).toHaveBeenCalledWith({
      login: 'value-for:/seo/prod/dataforseo-login',
      password: 'value-for:/seo/prod/dataforseo-password',
    });
    expect(createOpenRouterClient).toHaveBeenCalledWith({
      apiKey: 'value-for:/seo/prod/openrouter-api-key',
    });
  });

  test('getGenerationClients resolves the YouTube key from SSM', async () => {
    process.env.OPENROUTER_API_KEY_PARAM = '/seo/prod/openrouter-api-key';
    process.env.YOUTUBE_API_KEY_PARAM = '/seo/prod/youtube-api-key';
    getParameter.mockImplementation(async (name: string) => `value-for:${name}`);

    await getGenerationClients();

    expect(createYouTubeClient).toHaveBeenCalledWith({
      apiKey: 'value-for:/seo/prod/youtube-api-key',
    });
  });

  test('getImageClients resolves the fal key from SSM', async () => {
    process.env.OPENROUTER_API_KEY_PARAM = '/seo/prod/openrouter-api-key';
    process.env.FAL_KEY_PARAM = '/seo/prod/fal-key';
    getParameter.mockImplementation(async (name: string) => `value-for:${name}`);

    await getImageClients();

    expect(createFalClient).toHaveBeenCalledWith({ apiKey: 'value-for:/seo/prod/fal-key' });
  });
});
