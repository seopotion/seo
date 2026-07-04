import { afterEach, describe, expect, test, vi } from 'vitest';

const getParameter = vi.hoisted(() => vi.fn());
vi.mock('@aws-lambda-powertools/parameters/ssm', () => ({ getParameter }));

import { resolveMongoUri } from '../src/mongo-uri';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.clearAllMocks();
});

describe('resolveMongoUri', () => {
  test('uses the plain MONGO_URI env var when MONGO_URI_PARAM is unset', async () => {
    delete process.env.MONGO_URI_PARAM;
    process.env.MONGO_URI = 'mongodb://localhost:27017';

    await expect(resolveMongoUri()).resolves.toBe('mongodb://localhost:27017');
    expect(getParameter).not.toHaveBeenCalled();
  });

  test('defaults to localhost when neither var is set', async () => {
    delete process.env.MONGO_URI_PARAM;
    delete process.env.MONGO_URI;

    await expect(resolveMongoUri()).resolves.toBe('mongodb://localhost:27017');
  });

  test('fetches the SSM SecureString by name when MONGO_URI_PARAM is set', async () => {
    process.env.MONGO_URI_PARAM = '/seo/prod/mongo-uri';
    getParameter.mockResolvedValue('mongodb+srv://prod-cluster/seo');

    await expect(resolveMongoUri()).resolves.toBe('mongodb+srv://prod-cluster/seo');
    expect(getParameter).toHaveBeenCalledWith('/seo/prod/mongo-uri', {
      decrypt: true,
      maxAge: 3600,
    });
  });

  test('throws when the SSM parameter is missing or empty', async () => {
    process.env.MONGO_URI_PARAM = '/seo/prod/mongo-uri';
    getParameter.mockResolvedValue(undefined);

    await expect(resolveMongoUri()).rejects.toThrow('/seo/prod/mongo-uri');
  });
});
