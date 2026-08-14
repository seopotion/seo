import { describe, expect, test } from 'vitest';
import { StrategyFatalError, StrategyRetryableError, toStrategyError } from '../src/errors';

class FakeProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
  }
}

describe('toStrategyError', () => {
  test('a ProviderError-shaped error with retryable: true classifies as retryable', () => {
    const err = new FakeProviderError('rate limited', true);
    const result = toStrategyError(err);
    expect(result).toBeInstanceOf(StrategyRetryableError);
    expect(result.name).toBe('StrategyRetryableError');
    expect(result.message).toBe('rate limited');
    expect(result.cause).toBe(err);
  });

  test('a ProviderError-shaped error with retryable: false classifies as fatal', () => {
    const err = new FakeProviderError('bad request', false);
    const result = toStrategyError(err);
    expect(result).toBeInstanceOf(StrategyFatalError);
    expect(result.name).toBe('StrategyFatalError');
    expect(result.message).toBe('bad request');
    expect(result.cause).toBe(err);
  });

  test('a plain Error with no retryable verdict defaults to retryable', () => {
    const err = new Error('mongo blip');
    const result = toStrategyError(err);
    expect(result).toBeInstanceOf(StrategyRetryableError);
  });

  test('a non-Error thrown value defaults to retryable and stringifies the message', () => {
    const result = toStrategyError('boom');
    expect(result).toBeInstanceOf(StrategyRetryableError);
    expect(result.message).toBe('boom');
  });

  test('an already-typed StrategyRetryableError passes through unchanged', () => {
    const err = new StrategyRetryableError('already typed');
    expect(toStrategyError(err)).toBe(err);
  });

  test('an already-typed StrategyFatalError passes through unchanged', () => {
    const err = new StrategyFatalError('already typed fatal');
    expect(toStrategyError(err)).toBe(err);
  });
});
