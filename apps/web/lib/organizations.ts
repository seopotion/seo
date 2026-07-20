'use client';

import type { SetupStatus } from '@shared/schemas';
import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useRouter } from '@/i18n/navigation';
import { api } from './api';
import { clearToken } from './auth';
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

const ActiveOrganizationContext = createContext<ActiveOrganizationState | null>(null);

function useActiveOrganizationState(): ActiveOrganizationState {
  const router = useRouter();
  const [organization, setOrganization] = useState<ProductOrganization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ActiveOrganizationError | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);

      try {
        const activeOrganization = await getActiveOrganization();

        if (cancelled) return;

        setOrganization(activeOrganization);
        setError(activeOrganization ? null : 'no_organization');
      } catch (caughtError) {
        if (cancelled) return;

        setOrganization(null);

        if (caughtError instanceof OrganizationsApiError && caughtError.reason === 'unauthorized') {
          clearToken();
          clearWorkspaceStatusCache();
          setError('unauthorized');
          router.replace('/');
          return;
        }

        setError('unavailable');
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  return { error, loading, organization };
}

export function ActiveOrganizationProvider({ children }: { children: ReactNode }) {
  const state = useActiveOrganizationState();

  return createElement(ActiveOrganizationContext.Provider, { value: state }, children);
}

export function useActiveOrganization(): ActiveOrganizationState {
  const context = useContext(ActiveOrganizationContext);

  if (!context) {
    throw new Error('useActiveOrganization must be used within ActiveOrganizationProvider');
  }

  return context;
}
