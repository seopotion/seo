import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { dashboardQueryKeys } from './dashboard-query-keys';
import type { ProductOrganization } from './organizations';

export type ConnectedIntegration = {
  id: string;
  provider: 'wordpress';
  connected_at: string;
};

export type ConnectedIntegrationsResult = {
  integrations: ConnectedIntegration[];
};

/**
 * Fetches the org's connected publishing integrations (currently just WordPress).
 * Shared between the settings integrations panel and the article detail page.
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
