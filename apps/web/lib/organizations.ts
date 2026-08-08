'use client';

import type { SetupStatus } from '@shared/schemas';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from './api';
import { clearToken } from './auth';
import { dashboardQueryKeys } from './dashboard-query-keys';
import { clearWorkspaceStatusCache } from './session';

export type ProductOrganization = {
  capabilities: {
    keyword_research: boolean;
    keyword_scheduling: boolean;
  };
  id: string;
  name?: string;
  setup_status: SetupStatus;
  website_url: string;
};

export type ActiveOrganizationError = 'no_organization' | 'unauthorized' | 'unavailable';

export type ActiveOrganizationState = {
  error: ActiveOrganizationError | null;
  loading: boolean;
  organization: ProductOrganization | null;
};

export class OrganizationsApiError extends Error {
  reason: Exclude<ActiveOrganizationError, 'no_organization'>;

  constructor(reason: Exclude<ActiveOrganizationError, 'no_organization'>) {
    super(reason);
    this.name = 'OrganizationsApiError';
    this.reason = reason;
  }
}

export function selectActiveOrganization(
  organizations: ProductOrganization[],
): ProductOrganization | null {
  return (
    organizations.find((organization) => organization.setup_status === 'setup_complete') ??
    organizations[0] ??
    null
  );
}

export async function getOrganizations(): Promise<ProductOrganization[]> {
  const response = await api.api.v0.core.organizations.$get();

  if ((response.status as number) === 401) {
    throw new OrganizationsApiError('unauthorized');
  }

  if (!response.ok) {
    throw new OrganizationsApiError('unavailable');
  }

  const { organizations } = await response.json();
  return organizations;
}

export async function getActiveOrganization(): Promise<ProductOrganization | null> {
  return selectActiveOrganization(await getOrganizations());
}

/**
 * The active org, cached by react-query so a client navigation reuses it instead
 * of refetching. `loading` is `isPending` — true only when there is no data at
 * all, so a background refetch never blanks a page that already rendered.
 *
 * Called by both `ProductShell` and the page; react-query dedupes the two
 * observers into one request, which is why there is no context/provider.
 */
export function useActiveOrganization(): ActiveOrganizationState {
  const router = useRouter();

  const query = useQuery({
    queryKey: dashboardQueryKeys.organizations(),
    queryFn: getOrganizations,
    select: selectActiveOrganization,
    staleTime: 5 * 60 * 1000,
  });

  const organization = query.data ?? null;
  // `null` (not `undefined`) is what distinguishes "loaded, user has no org"
  // from "not loaded yet" — `select` returns `null` for an empty list.
  const error: ActiveOrganizationError | null =
    query.error instanceof OrganizationsApiError
      ? query.error.reason
      : query.error
        ? 'unavailable'
        : query.data === null
          ? 'no_organization'
          : null;

  // A 401 on the org list means the session is gone. Deliberately does NOT call
  // queryClient.clear() — clearing while this query has observers would refetch,
  // 401 again, and loop. Token + workspace-status are what the login flow reads.
  useEffect(() => {
    if (error !== 'unauthorized') return;

    clearToken();
    clearWorkspaceStatusCache();
    router.replace('/');
  }, [error, router]);

  return { error, loading: query.isPending, organization };
}
