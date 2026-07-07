/** Normalized, credential-free failure categories shared by the LLM and image providers. */
export type ProviderErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'provider'
  | 'timeout'
  | 'network';

const RETRYABLE: ReadonlySet<ProviderErrorCategory> = new Set([
  'rate_limit',
  'provider',
  'network',
  'timeout',
]);

export function isRetryableProviderError(category: ProviderErrorCategory): boolean {
  return RETRYABLE.has(category);
}

/** Map an HTTP response status to a category. */
export function categorizeProviderHttpStatus(status: number): ProviderErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'invalid_request';
}

/**
 * A provider failure. Messages/fields never include the API key or the
 * Authorization header.
 */
export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;

  constructor(category: ProviderErrorCategory, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.category = category;
    this.retryable = isRetryableProviderError(category);
  }
}
