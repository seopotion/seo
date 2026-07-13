import { describe, expect, test } from 'vitest';
import { categorizeProviderHttpStatus, isRetryableProviderError, ProviderError } from '../src';

describe('categorizeProviderHttpStatus', () => {
  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'invalid_request'],
    [404, 'invalid_request'],
    [500, 'provider'],
    [503, 'provider'],
  ])('%i -> %s', (status, expected) => {
    expect(categorizeProviderHttpStatus(status as number)).toBe(expected);
  });
});

describe('isRetryableProviderError', () => {
  test('retries transient categories only', () => {
    expect(isRetryableProviderError('rate_limit')).toBe(true);
    expect(isRetryableProviderError('provider')).toBe(true);
    expect(isRetryableProviderError('network')).toBe(true);
    expect(isRetryableProviderError('timeout')).toBe(true);
    expect(isRetryableProviderError('auth')).toBe(false);
    expect(isRetryableProviderError('invalid_request')).toBe(false);
  });
});

describe('ProviderError', () => {
  test('carries category + retryable and leaks no credentials', () => {
    const err = new ProviderError('auth', 'OpenRouter request failed (auth)');
    expect(err.category).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('ProviderError');
    expect(err.message).not.toMatch(/bearer|authorization|key /i);
  });
});
