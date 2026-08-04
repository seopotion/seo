import { afterEach, describe, expect, test, vi } from 'vitest';

const getParameter = vi.hoisted(() => vi.fn());
vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({ getParameter }));

import { resolveProviderSecret } from '../src/secrets';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe('resolveProviderSecret', () => {
  test('uses the plain env var when <NAME>_PARAM is unset', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-local';
    delete process.env.OPENROUTER_API_KEY_PARAM;

    await expect(resolveProviderSecret('OPENROUTER_API_KEY')).resolves.toBe('sk-local');
    expect(getParameter).not.toHaveBeenCalled();
  });

  test('returns an empty string when neither var is set', async () => {
    delete process.env.FAL_KEY;
    delete process.env.FAL_KEY_PARAM;

    await expect(resolveProviderSecret('FAL_KEY')).resolves.toBe('');
  });

  test('fetches the SSM SecureString by name when <NAME>_PARAM is set', async () => {
    process.env.DATAFORSEO_PASSWORD_PARAM = '/seo/prod/dataforseo-password';
    getParameter.mockResolvedValue('prod-password');

    await expect(resolveProviderSecret('DATAFORSEO_PASSWORD')).resolves.toBe('prod-password');
    expect(getParameter).toHaveBeenCalledWith('/seo/prod/dataforseo-password', {
      decrypt: true,
      maxAge: 3600,
    });
  });

  test('prefers the SSM parameter over a plain env var of the same name', async () => {
    process.env.YOUTUBE_API_KEY = 'stale-local-value';
    process.env.YOUTUBE_API_KEY_PARAM = '/seo/prod/youtube-api-key';
    getParameter.mockResolvedValue('prod-youtube-key');

    await expect(resolveProviderSecret('YOUTUBE_API_KEY')).resolves.toBe('prod-youtube-key');
  });

  test('throws naming the parameter when it is missing or empty', async () => {
    process.env.DATAFORSEO_LOGIN_PARAM = '/seo/prod/dataforseo-login';
    getParameter.mockResolvedValue(undefined);

    await expect(resolveProviderSecret('DATAFORSEO_LOGIN')).rejects.toThrow(
      '/seo/prod/dataforseo-login',
    );
  });
});
