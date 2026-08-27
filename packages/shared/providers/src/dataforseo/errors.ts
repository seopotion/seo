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

/** Credential problems: 40100 Not Authorized, 40104 Account Verification Required. */
const AUTH_CODES: ReadonlySet<number> = new Set([40100, 40104]);

/**
 * The search engine failed us mid-task: 40101 "Internal SE Server Error",
 * 40103 "Task Execution Failed". DataForSEO's own docs say to post the task
 * again, so these are provider blips, not our problem.
 */
const TRANSIENT_TASK_CODES: ReadonlySet<number> = new Set([40101, 40103]);

/** "No Search Results." — an empty SERP, not a failure. Handled in the client. */
export const NO_SEARCH_RESULTS_CODE = 40102;

/**
 * Map a DataForSEO body `status_code` (returned even on HTTP 200) to a category.
 * 40200 = out of funds, other 402xx = rate/quota limit, 5xxxx = provider, else
 * invalid request.
 *
 * 401xx is deliberately NOT treated as an auth block: despite looking like HTTP
 * 401 it mixes credential errors with transient search-engine failures. Reading
 * the whole range as auth made 40101 non-retryable, and one keyword's SERP blip
 * fataled a whole production strategy run.
 */
export function categorizeApiStatus(code: number): DataForSeoErrorCategory {
  if (AUTH_CODES.has(code)) return 'auth';
  if (TRANSIENT_TASK_CODES.has(code)) return 'provider';
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
  /** HTTP response status, when the failure came from a non-ok HTTP response. */
  readonly status: number | null;

  constructor(category: DataForSeoErrorCategory, message: string, opts?: { status?: number }) {
    super(message);
    this.name = 'DataForSeoError';
    this.category = category;
    this.retryable = isRetryable(category);
    this.status = opts?.status ?? null;
  }
}
