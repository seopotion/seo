import { describe, expect, test } from 'vitest';
import {
  bodySnippet,
  categorizeProviderHttpStatus,
  isRetryableProviderError,
  ProviderError,
  providerHttpError,
} from '../src';

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

  test('status and bodySnippet default to null', () => {
    const err = new ProviderError('network', 'OpenRouter request failed (network)');
    expect(err.status).toBeNull();
    expect(err.bodySnippet).toBeNull();
  });

  test('carries structured status and bodySnippet when given', () => {
    const err = new ProviderError('invalid_request', 'msg', {
      status: 402,
      bodySnippet: '{"error":"Insufficient credits"}',
    });
    expect(err.status).toBe(402);
    expect(err.bodySnippet).toBe('{"error":"Insufficient credits"}');
  });
});

describe('bodySnippet', () => {
  test('collapses whitespace', () => {
    expect(bodySnippet('{\n  "error":   "boom"\n}')).toBe('{ "error": "boom" }');
  });

  test('truncates long bodies with an ellipsis', () => {
    const out = bodySnippet('x'.repeat(500));
    expect(out.length).toBeLessThanOrEqual(201);
    expect(out.endsWith('…')).toBe(true);
  });

  test('redacts credential-shaped tokens after auth scheme words', () => {
    const out = bodySnippet('Bearer sk-or-v1-0123456789abcdef0123456789abcdef and more');
    expect(out).not.toContain('sk-or-v1');
    expect(out).toContain('[redacted]');
  });

  test('empty body yields empty string', () => {
    expect(bodySnippet('   ')).toBe('');
  });
});

describe('providerHttpError', () => {
  // The staging failure this exists for: OpenRouter 402 "insufficient credits"
  // surfaced as a bare "invalid_request" and needed manual probing to diagnose.
  test('message carries HTTP status and a body snippet', async () => {
    const res = new Response(
      JSON.stringify({ error: { message: 'This request requires more credits', code: 402 } }),
      { status: 402 },
    );
    const err = await providerHttpError('OpenRouter', res);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.category).toBe('invalid_request');
    expect(err.status).toBe(402);
    expect(err.message).toMatch(/HTTP 402/);
    expect(err.message).toContain('This request requires more credits');
  });

  test('empty body still yields the status in the message', async () => {
    const err = await providerHttpError('YouTube', new Response('', { status: 500 }));
    expect(err.category).toBe('provider');
    expect(err.status).toBe(500);
    expect(err.message).toBe('YouTube request failed (provider): HTTP 500');
    expect(err.bodySnippet).toBeNull();
  });
});
