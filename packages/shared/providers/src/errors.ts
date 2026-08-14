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

const MAX_SNIPPET_LENGTH = 200;

/**
 * Shrink a raw response body into a log-safe excerpt: collapse whitespace,
 * redact credential-shaped tokens (in case a provider echoes an auth header),
 * and truncate.
 */
export function bodySnippet(raw: string): string {
  const scrubbed = raw
    .replace(/\b(bearer|basic|key)\s+[\w.~+/=-]{16,}/gi, '$1 [redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (scrubbed.length <= MAX_SNIPPET_LENGTH) return scrubbed;
  return `${scrubbed.slice(0, MAX_SNIPPET_LENGTH)}…`;
}

/**
 * A provider failure. Messages/fields never include the API key or the
 * Authorization header.
 */
export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;
  readonly retryable: boolean;
  /** HTTP response status, when the failure came from an HTTP response. */
  readonly status: number | null;
  /** Truncated, credential-free response-body excerpt, when one was readable. */
  readonly bodySnippet: string | null;

  constructor(
    category: ProviderErrorCategory,
    message: string,
    opts?: { status?: number; bodySnippet?: string },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.category = category;
    this.retryable = isRetryableProviderError(category);
    this.status = opts?.status ?? null;
    this.bodySnippet = opts?.bodySnippet ?? null;
  }
}

/**
 * Build the ProviderError for a non-ok HTTP response, embedding the status and
 * a body snippet so logs are self-diagnosing (e.g. a 402 "insufficient
 * credits" body instead of a bare invalid_request).
 */
export async function providerHttpError(provider: string, res: Response): Promise<ProviderError> {
  const category = categorizeProviderHttpStatus(res.status);
  const snippet = bodySnippet(await res.text().catch(() => ''));
  const detail = snippet ? ` — ${snippet}` : '';
  return new ProviderError(
    category,
    `${provider} request failed (${category}): HTTP ${res.status}${detail}`,
    { status: res.status, ...(snippet ? { bodySnippet: snippet } : {}) },
  );
}
