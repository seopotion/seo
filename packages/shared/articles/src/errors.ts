/** A stage failure worth retrying — SFN's Retry matches on this name. */
export class ArticleRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ArticleRetryableError';
  }
}

/** A stage failure retrying cannot fix — fails the execution immediately. */
export class ArticleFatalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ArticleFatalError';
  }
}

/**
 * Classify any stage error for the state machine. Providers already carry a
 * `retryable` verdict (ProviderError, DataForSeoError); only an explicit
 * `retryable: false` is fatal — unknown failures (network, Mongo blips) default
 * to retryable because a retry is cheap at stage granularity.
 */
export function toArticleError(err: unknown): ArticleRetryableError | ArticleFatalError {
  if (err instanceof ArticleRetryableError || err instanceof ArticleFatalError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const retryable = (err as { retryable?: unknown })?.retryable !== false;
  return retryable
    ? new ArticleRetryableError(message, { cause: err })
    : new ArticleFatalError(message, { cause: err });
}
