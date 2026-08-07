import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { dashboardQueryKeys } from './dashboard-query-keys';
import type { ProductOrganization } from './organizations';

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
  organization: ProductOrganization | null,
  options?: { enabled?: boolean; onUnauthorized?: () => void },
) {
  const { enabled = true, onUnauthorized } = options ?? {};

  return useQuery({
    queryKey: dashboardQueryKeys.connectedIntegrations(organization?.id ?? ''),
    queryFn: async (): Promise<ConnectedIntegrationsResult> => {
      if (!organization) {
        throw new Error('organization_required');
      }

      const response = await api.api.v0.dashboard.integrations.connected.$get({
        query: { org_id: organization.id },
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
    enabled: Boolean(organization) && enabled,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}
