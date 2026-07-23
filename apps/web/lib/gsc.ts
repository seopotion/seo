import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { dashboardQueryKeys } from './dashboard-query-keys';
import type { GscStatus } from './gsc-match';
import type { ProductOrganization } from './organizations';

/**
 * Google Search Console connect flow (#12). The Settings panel drives the OAuth
 * round-trip (auth-url -> Google consent -> callback -> property pick); this
 * module holds the status query. Pure helpers + types live in `./gsc-match` (and
 * are re-exported here) so they stay importable without the api/DOM graph.
 */

export type { GscSite, GscStatus } from './gsc-match';
export { GSC_RETURN_LOCALE_KEY, matchGscProperty } from './gsc-match';

/**
 * Fetches the org's GSC connection state (DB read only — no Google calls).
 * Mirrors `useConnectedIntegrations`: 401 -> onUnauthorized, gated by an org.
 */
export function useGscStatus(
  organization: ProductOrganization | null,
  options?: { onUnauthorized?: () => void },
) {
  const { onUnauthorized } = options ?? {};

  return useQuery({
    queryKey: dashboardQueryKeys.gscStatus(organization?.id ?? ''),
    queryFn: async (): Promise<GscStatus> => {
      if (!organization) {
        throw new Error('organization_required');
      }

      const response = await api.api.v0.dashboard.gsc.status.$get({
        query: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        onUnauthorized?.();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('gsc_status_load_failed');
      }

      return response.json();
    },
    enabled: Boolean(organization),
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
}
