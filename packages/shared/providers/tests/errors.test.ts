import { describe, expect, test } from 'vitest';
import { categorizeApiStatus, categorizeHttpStatus, DataForSeoError, isRetryable } from '../src';

describe('categorizeHttpStatus', () => {
  test.each([
    [401, 'auth'],
    [403, 'auth'],
    [402, 'payment_required'],
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
  // 401xx is NOT an auth block the way HTTP 401 is: only 40100 (Not Authorized)
  // and 40104 (Account Verification Required) are credential problems. 40101
  // ("Internal SE Server Error") and 40103 ("Task Execution Failed") are the
  // search engine failing us mid-task — transient, and the docs say to retry.
  // Bucketing the whole range as auth made them non-retryable and killed a
  // whole prod strategy run on one keyword's SERP blip. 40102 ("No Search
  // Results") never reaches here — the client returns it as an empty result.
  test.each([
    [40100, 'auth'],
    [40101, 'provider'],
    [40103, 'provider'],
    [40104, 'auth'],
    [40200, 'payment_required'],
    [40202, 'rate_limit'],
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
    expect(isRetryable('payment_required')).toBe(false);
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
