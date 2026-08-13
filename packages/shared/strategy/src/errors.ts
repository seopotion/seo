/** A stage failure worth retrying — SFN's Retry matches on this name. */
export class StrategyRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StrategyRetryableError';
  }
}

/** A stage failure retrying cannot fix — fails the execution immediately. */
export class StrategyFatalError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StrategyFatalError';
  }
}

/**
 * Classify any stage error for the state machine. Providers already carry a
 * `retryable` verdict (ProviderError, DataForSeoError); only an explicit
 * `retryable: false` is fatal — unknown failures (network, Mongo blips) default
 * to retryable because a retry is cheap at stage granularity.
 */
export function toStrategyError(err: unknown): StrategyRetryableError | StrategyFatalError {
  if (err instanceof StrategyRetryableError || err instanceof StrategyFatalError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const retryable = (err as { retryable?: unknown })?.retryable !== false;
  return retryable
    ? new StrategyRetryableError(message, { cause: err })
    : new StrategyFatalError(message, { cause: err });
}
