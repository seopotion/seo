import type { SetupStatus } from '@shared/schemas';
import { api } from './api';

type SetupOrganization = {
  id: string;
  website_url: string;
  setup_status: SetupStatus;
  name?: string;
};

export async function getPostLoginPath(): Promise<'/home' | '/onboarding' | null> {
  const orgsRes = await api.api.v0.core.organizations.$get();

  if (orgsRes.ok) {
    const { organizations } = await orgsRes.json();
    return (organizations as SetupOrganization[]).some(
      (organization) => organization.setup_status === 'setup_complete',
    )
      ? '/home'
      : '/onboarding';
  }

  const statusRes = await api.api.v0.core.status.$get();
  if (!statusRes.ok) return null;

  const { setup_complete } = await statusRes.json();
  return setup_complete ? '/home' : '/onboarding';
}
