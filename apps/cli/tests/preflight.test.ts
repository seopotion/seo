import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the SSM client the same way infra.test.ts mocks SQS: a constructor
// returning an object whose `send` we control per test.
const { ssmSend } = vi.hoisted(() => ({
  ssmSend: vi.fn(),
}));

vi.mock('@aws-sdk/client-ssm', () => ({
  // biome-ignore lint/complexity/useArrowFunction: regular function required — arrow fns are not constructors
  SSMClient: vi.fn(function () {
    return { send: ssmSend, destroy: vi.fn() };
  }),
  // biome-ignore lint/complexity/useArrowFunction: regular function required — arrow fns are not constructors
  GetParameterCommand: vi.fn(function (input: unknown) {
    return input;
  }),
}));

import { preflight } from '../src/lib/preflight';

// A GetParameter response that resolves the SecureString to a non-empty value.
const paramValue = (value: string) => ({ Parameter: { Value: value } });

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID_STAGING = 'staging-client.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_ID_PROD = 'prod-client.apps.googleusercontent.com';
  process.env.WEB_ORIGIN_STAGING = 'https://app-staging.seopotion.co';
  process.env.WEB_ORIGIN_PROD = 'https://app.seopotion.co';
  process.env.LEMONSQUEEZY_STORE_ID_STAGING = 'store_staging';
  process.env.LEMONSQUEEZY_STORE_ID_PROD = 'store_prod';
  process.env.LEMONSQUEEZY_VARIANT_PAID_STAGING = 'variant_paid_staging';
  process.env.LEMONSQUEEZY_VARIANT_PAID_PROD = 'variant_paid_prod';
  process.env.LEMONSQUEEZY_VARIANT_EXPERT_STAGING = 'variant_expert_staging';
  process.env.LEMONSQUEEZY_VARIANT_EXPERT_PROD = 'variant_expert_prod';
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.GOOGLE_CLIENT_ID_STAGING;
  delete process.env.GOOGLE_CLIENT_ID_PROD;
  delete process.env.WEB_ORIGIN_STAGING;
  delete process.env.WEB_ORIGIN_PROD;
  delete process.env.LEMONSQUEEZY_STORE_ID_STAGING;
  delete process.env.LEMONSQUEEZY_STORE_ID_PROD;
  delete process.env.LEMONSQUEEZY_VARIANT_PAID_STAGING;
  delete process.env.LEMONSQUEEZY_VARIANT_PAID_PROD;
  delete process.env.LEMONSQUEEZY_VARIANT_EXPERT_STAGING;
  delete process.env.LEMONSQUEEZY_VARIANT_EXPERT_PROD;
});

describe('preflight', () => {
  test('ready when all SSM params resolve non-empty and the env vars are set', async () => {
    ssmSend.mockResolvedValue(paramValue('present'));

    const res = await preflight('staging');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.ready).toBe(true);
    expect(res.data.checks.every((c) => c.present)).toBe(true);
    // Presence check must not decrypt — keeps the CI deploy role free of kms:Decrypt.
    expect(ssmSend).toHaveBeenCalledWith(expect.objectContaining({ WithDecryption: false }));
    // jwt-secret, mongo-uri, google-client-secret, gsc-token-key, lemonsqueezy-api-key,
    // lemonsqueezy-webhook-secret, the two admin params, the five provider
    // credentials, and the five public env vars.
    expect(res.data.checks.map((c) => c.name).sort()).toEqual([
      '/seo/staging/admin/jwt-secret',
      '/seo/staging/admin/operators',
      '/seo/staging/dataforseo-login',
      '/seo/staging/dataforseo-password',
      '/seo/staging/fal-key',
      '/seo/staging/google-client-secret',
      '/seo/staging/gsc-token-key',
      '/seo/staging/jwt-secret',
      '/seo/staging/lemonsqueezy-api-key',
      '/seo/staging/lemonsqueezy-webhook-secret',
      '/seo/staging/mongo-uri',
      '/seo/staging/openrouter-api-key',
      '/seo/staging/youtube-api-key',
      'GOOGLE_CLIENT_ID_STAGING',
      'LEMONSQUEEZY_STORE_ID_STAGING',
      'LEMONSQUEEZY_VARIANT_EXPERT_STAGING',
      'LEMONSQUEEZY_VARIANT_PAID_STAGING',
      'WEB_ORIGIN_STAGING',
    ]);
  });

  test('checks the prod-scoped names when stage is prod', async () => {
    ssmSend.mockResolvedValue(paramValue('present'));

    const res = await preflight('prod');
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.checks.map((c) => c.name).sort()).toEqual([
      '/seo/prod/admin/jwt-secret',
      '/seo/prod/admin/operators',
      '/seo/prod/dataforseo-login',
      '/seo/prod/dataforseo-password',
      '/seo/prod/fal-key',
      '/seo/prod/google-client-secret',
      '/seo/prod/gsc-token-key',
      '/seo/prod/jwt-secret',
      '/seo/prod/lemonsqueezy-api-key',
      '/seo/prod/lemonsqueezy-webhook-secret',
      '/seo/prod/mongo-uri',
      '/seo/prod/openrouter-api-key',
      '/seo/prod/youtube-api-key',
      'GOOGLE_CLIENT_ID_PROD',
      'LEMONSQUEEZY_STORE_ID_PROD',
      'LEMONSQUEEZY_VARIANT_EXPERT_PROD',
      'LEMONSQUEEZY_VARIANT_PAID_PROD',
      'WEB_ORIGIN_PROD',
    ]);
  });

  test('not ready when an SSM parameter is missing (ParameterNotFound)', async () => {
    ssmSend.mockRejectedValue(Object.assign(new Error('not found'), { name: 'ParameterNotFound' }));

    const res = await preflight('staging');
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.ready).toBe(false);
    const jwt = res.data.checks.find((c) => c.name === '/seo/staging/jwt-secret');
    expect(jwt).toMatchObject({ present: false });
    expect(jwt?.error).toBeDefined();
  });

  test('not ready when an SSM parameter resolves to an empty string', async () => {
    ssmSend.mockResolvedValue(paramValue(''));

    const res = await preflight('staging');
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.ready).toBe(false);
    expect(res.data.checks.find((c) => c.name === '/seo/staging/mongo-uri')).toMatchObject({
      present: false,
    });
  });

  test('not ready when the google client id env var is unset', async () => {
    delete process.env.GOOGLE_CLIENT_ID_STAGING;
    ssmSend.mockResolvedValue(paramValue('present'));

    const res = await preflight('staging');
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.ready).toBe(false);
    expect(res.data.checks.find((c) => c.name === 'GOOGLE_CLIENT_ID_STAGING')).toMatchObject({
      present: false,
      kind: 'env',
    });
  });

  test('not ready when the web origin env var is unset or empty', async () => {
    process.env.WEB_ORIGIN_STAGING = '';
    ssmSend.mockResolvedValue(paramValue('present'));

    const res = await preflight('staging');
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.ready).toBe(false);
    expect(res.data.checks.find((c) => c.name === 'WEB_ORIGIN_STAGING')).toMatchObject({
      present: false,
      kind: 'env',
    });
  });

  test('not ready when a new GSC SSM param is missing', async () => {
    ssmSend.mockImplementation(async (cmd: { Name: string }) =>
      cmd.Name === '/seo/staging/gsc-token-key'
        ? Promise.reject(Object.assign(new Error('not found'), { name: 'ParameterNotFound' }))
        : paramValue('present'),
    );

    const res = await preflight('staging');
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.ready).toBe(false);
    expect(res.data.checks.find((c) => c.name === '/seo/staging/gsc-token-key')).toMatchObject({
      present: false,
    });
  });

  test('not ready when a provider credential is missing', async () => {
    ssmSend.mockImplementation(async (cmd: { Name: string }) =>
      cmd.Name === '/seo/prod/openrouter-api-key'
        ? Promise.reject(Object.assign(new Error('not found'), { name: 'ParameterNotFound' }))
        : paramValue('present'),
    );

    const res = await preflight('prod');
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.ready).toBe(false);
    expect(res.data.checks.find((c) => c.name === '/seo/prod/openrouter-api-key')).toMatchObject({
      present: false,
    });
  });

  test('not ready when the admin operator allowlist is missing', async () => {
    ssmSend.mockImplementation(async (cmd: { Name: string }) =>
      cmd.Name === '/seo/staging/admin/operators'
        ? Promise.reject(Object.assign(new Error('not found'), { name: 'ParameterNotFound' }))
        : paramValue('present'),
    );

    const res = await preflight('staging');
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.ready).toBe(false);
    expect(res.data.checks.find((c) => c.name === '/seo/staging/admin/operators')).toMatchObject({
      present: false,
    });
  });
});
