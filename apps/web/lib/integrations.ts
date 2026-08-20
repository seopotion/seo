import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { dashboardQueryKeys } from './dashboard-query-keys';

export type ConnectedIntegration = {
  id: string;
  provider: 'wordpress' | 'static-site';
  // What to render after "Connected to": the site URL for WordPress,
  // `owner/repo@branch` for a static site. Built server-side.
  target: string;
  connected_at: string;
  // The last publish failure that will still be true on a retry (uninstalled,
  // repo dropped, branch protected). Webhooks are off in v1, so this is how the
  // panel learns a connection has died; a successful publish clears it.
  last_error: { code: string; at: string } | null;
};

export type ConnectedIntegrationsResult = {
  integrations: ConnectedIntegration[];
};

/** A repository the GitHub App installation can reach, as the callback lists it. */
export type GithubRepoSummary = {
  full_name: string;
  default_branch: string;
  private: boolean;
};

/**
 * `integration.last_error.code` -> a message key. These are the GithubError
 * codes the publish route persists (its 422 bucket); anything else falls back
 * to `unknown`, so a new code added server-side degrades to a generic line
 * rather than rendering a raw identifier.
 */
export type PublishErrorKey =
  | 'publishErrors.installationGone'
  | 'publishErrors.suspended'
  | 'publishErrors.missingPermission'
  | 'publishErrors.repoNotFound'
  | 'publishErrors.commitRejected'
  | 'publishErrors.unknown';

export const PUBLISH_ERROR_KEYS: Record<string, PublishErrorKey> = {
  installation_not_found: 'publishErrors.installationGone',
  installation_suspended: 'publishErrors.suspended',
  missing_write_permission: 'publishErrors.missingPermission',
  repo_not_found: 'publishErrors.repoNotFound',
  commit_rejected: 'publishErrors.commitRejected',
};

/**
 * Of those, the ones the user fixes by reinstalling rather than retrying.
 * `commit_rejected` is deliberately absent: the connection is healthy, the
 * branch is protected — reinstalling would change nothing.
 */
export const RECONNECT_CODES = new Set([
  'installation_not_found',
  'installation_suspended',
  'missing_write_permission',
  'repo_not_found',
]);

/**
 * sessionStorage key: the Settings panel stores the user's locale before handing
 * off to github.com. The App's Setup URL is one fixed unprefixed path, so the
 * user always returns to the default locale — same problem and same fix as
 * `GSC_RETURN_LOCALE_KEY` (design/github-app.md § Locale).
 */
export const GITHUB_RETURN_LOCALE_KEY = 'seo_github_return_locale';

/**
 * Fetches the org's connected publishing integrations. Shared between the
 * settings integrations panel and the article detail page.
 */
export function useConnectedIntegrations(
  organizationId: string | null,
  options?: { enabled?: boolean; onUnauthorized?: () => void },
) {
  const { enabled = true, onUnauthorized } = options ?? {};

  return useQuery({
    queryKey: dashboardQueryKeys.connectedIntegrations(organizationId ?? ''),
    queryFn: async (): Promise<ConnectedIntegrationsResult> => {
      if (!organizationId) {
        throw new Error('organization_required');
      }

      const response = await api.api.v0.dashboard.integrations.connected.$get({
        query: { org_id: organizationId },
      });

      if ((response.status as number) === 401) {
        onUnauthorized?.();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('integrations_load_failed');
      }

      return response.json();
    },
    enabled: Boolean(organizationId) && enabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}
