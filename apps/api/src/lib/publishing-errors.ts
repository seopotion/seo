import type { IntegrationProvider, PublishingError } from '@shared/schemas';
import { GithubError } from '../clients/github';

export class PublishingFailure extends Error {
  constructor(
    readonly error: PublishingError,
    readonly httpStatus: 400 | 403 | 404 | 409 | 422 | 500 | 502 = 502,
  ) {
    super(error.message);
    this.name = 'PublishingFailure';
  }
}

export function publishingFailure(
  code: string,
  kind: PublishingError['kind'],
  message: string,
  httpStatus: PublishingFailure['httpStatus'] = 502,
  at: Date = new Date(),
): PublishingFailure {
  return new PublishingFailure({ code, kind, message, at }, httpStatus);
}

const githubMessages: Record<string, string> = {
  installation_not_found: 'The GitHub App installation is missing. Reconnect the static site.',
  installation_suspended: 'The GitHub App installation is suspended.',
  missing_write_permission: 'The GitHub App needs repository contents write permission.',
  repo_not_found: 'The configured GitHub repository or branch is unavailable.',
  commit_rejected: 'GitHub rejected the commit. Check branch protection and repository access.',
  ref_conflict: 'The GitHub branch changed repeatedly while publishing. Retry shortly.',
  github_request_failed: 'GitHub could not be reached or returned an invalid response.',
};

export function normalizePublishingError(
  err: unknown,
  provider: IntegrationProvider,
  at: Date = new Date(),
): PublishingFailure {
  if (err instanceof PublishingFailure) return err;
  if (err instanceof GithubError) {
    const transient = err.code === 'github_request_failed' || err.code === 'ref_conflict';
    return publishingFailure(
      err.code,
      transient ? 'transient' : 'permanent',
      githubMessages[err.code] ?? 'GitHub publishing failed.',
      err.code === 'ref_conflict' ? 409 : transient ? 502 : 422,
      at,
    );
  }
  const invalidResponse =
    err instanceof SyntaxError ||
    (err instanceof Error && /invalid .*response|returned no image/i.test(err.message));
  if (invalidResponse) {
    return publishingFailure(
      'invalid_provider_response',
      'transient',
      `${provider === 'wordpress' ? 'WordPress' : 'GitHub'} returned an invalid response.`,
      502,
      at,
    );
  }
  return publishingFailure(
    provider === 'static-site' ? 'github_request_failed' : 'network_error',
    'transient',
    `${provider === 'wordpress' ? 'WordPress' : 'GitHub'} could not be reached.`,
    502,
    at,
  );
}

export function isIntegrationPublishingError(code: string): boolean {
  return [
    'invalid_credentials',
    'wordpress_auth_failed',
    'plugin_upgrade_required',
    'installation_not_found',
    'installation_suspended',
    'missing_write_permission',
    'repo_not_found',
    'commit_rejected',
  ].includes(code);
}
