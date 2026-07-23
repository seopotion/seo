/** Normalized, credential-free failure categories for DataForSEO calls. */
export type DataForSeoErrorCategory =
  | 'auth'
  | 'rate_limit'
  | 'payment_required'
  | 'invalid_request'
  | 'provider'
  | 'timeout'
  | 'network';

const RETRYABLE: ReadonlySet<DataForSeoErrorCategory> = new Set([
  'rate_limit',
  'provider',
  'network',
  'timeout',
]);

export function isRetryable(category: DataForSeoErrorCategory): boolean {
  return RETRYABLE.has(category);
}

/** Map an HTTP response status to a category. */
export function categorizeHttpStatus(status: number): DataForSeoErrorCategory {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'payment_required';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider';
  return 'invalid_request';
}

/**
 * Map a DataForSEO body `status_code` (returned even on HTTP 200) to a category.
 * 401xx = auth, 40200 = out of funds, other 402xx = rate/quota limit,
 * 5xxxx = provider, else invalid request.
 */
export function categorizeApiStatus(code: number): DataForSeoErrorCategory {
  if (code >= 40100 && code < 40200) return 'auth';
  if (code === 40200) return 'payment_required';
  if (code > 40200 && code < 40300) return 'rate_limit';
  if (code >= 50000) return 'provider';
  return 'invalid_request';
}

/**
 * A DataForSEO failure. Messages/fields never include credentials or the
 * Authorization header.
 */
export class DataForSeoError extends Error {
  readonly category: DataForSeoErrorCategory;
  readonly retryable: boolean;

  constructor(category: DataForSeoErrorCategory, message: string) {
    super(message);
    this.name = 'DataForSeoError';
    this.category = category;
    this.retryable = isRetryable(category);
  }
}
