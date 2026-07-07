import { describe, expect, test } from 'vitest';
import { categorizeApiStatus, categorizeHttpStatus, DataForSeoError, isRetryable } from '../src';

describe('categorizeHttpStatus', () => {
  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [429, 'rate_limit'],
    [400, 'invalid_request'],
    [404, 'invalid_request'],
    [500, 'provider'],
    [503, 'provider'],
  ])('%i -> %s', (status, expected) => {
    expect(categorizeHttpStatus(status as number)).toBe(expected);
  });
});

describe('categorizeApiStatus (DataForSEO body status_code)', () => {
  test.each([
    [40100, 'auth'],
    [40200, 'rate_limit'],
    [40000, 'invalid_request'],
    [50000, 'provider'],
  ])('%i -> %s', (code, expected) => {
    expect(categorizeApiStatus(code as number)).toBe(expected);
  });
});

describe('isRetryable', () => {
  test('retries transient categories only', () => {
    expect(isRetryable('rate_limit')).toBe(true);
    expect(isRetryable('provider')).toBe(true);
    expect(isRetryable('network')).toBe(true);
    expect(isRetryable('timeout')).toBe(true);
    expect(isRetryable('auth')).toBe(false);
    expect(isRetryable('invalid_request')).toBe(false);
  });
});

describe('DataForSeoError', () => {
  test('carries category + retryable and leaks no credentials', () => {
    const err = new DataForSeoError('auth', 'DataForSEO request failed (auth)');
    expect(err.category).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('DataForSeoError');
    expect(err.message).not.toMatch(/authorization|basic |password/i);
  });
});
