import { describe, expect, test } from 'vitest';
import { ArticleFatalError, ArticleRetryableError, toArticleError } from '../src/errors';

class FakeProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
  }
}

describe('toArticleError', () => {
  test('a ProviderError-shaped error with retryable: true classifies as retryable', () => {
    const err = new FakeProviderError('rate limited', true);
    const result = toArticleError(err);
    expect(result).toBeInstanceOf(ArticleRetryableError);
    expect(result.name).toBe('ArticleRetryableError');
    expect(result.message).toBe('rate limited');
    expect(result.cause).toBe(err);
  });

  test('a ProviderError-shaped error with retryable: false classifies as fatal', () => {
    const err = new FakeProviderError('bad request', false);
    const result = toArticleError(err);
    expect(result).toBeInstanceOf(ArticleFatalError);
    expect(result.name).toBe('ArticleFatalError');
    expect(result.message).toBe('bad request');
    expect(result.cause).toBe(err);
  });

  test('a plain Error with no retryable verdict defaults to retryable', () => {
    const err = new Error('mongo blip');
    const result = toArticleError(err);
    expect(result).toBeInstanceOf(ArticleRetryableError);
  });

  test('a non-Error thrown value defaults to retryable and stringifies the message', () => {
    const result = toArticleError('boom');
    expect(result).toBeInstanceOf(ArticleRetryableError);
    expect(result.message).toBe('boom');
  });

  test('an already-typed ArticleRetryableError passes through unchanged', () => {
    const err = new ArticleRetryableError('already typed');
    expect(toArticleError(err)).toBe(err);
  });

  test('an already-typed ArticleFatalError passes through unchanged', () => {
    const err = new ArticleFatalError('already typed fatal');
    expect(toArticleError(err)).toBe(err);
  });
});
