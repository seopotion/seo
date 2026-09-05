'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { setActiveOrganizationId } from '@/lib/active-organization';
import {
  type ProductOrganization,
  useActiveOrganization,
  useOrganizations,
} from '@/lib/organizations';

// Sentinel select value: an action row, not an org.
const ADD_WEBSITE = '__add__';

function hostOf(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).host;
  } catch {
    return websiteUrl;
  }
}

function labelOf(organization: ProductOrganization): string {
  return organization.name ?? hostOf(organization.website_url);
}

/**
 * Which of the user's orgs the product shell shows. Lists only completed orgs:
 * an abandoned scan is not somewhere the shell can land. Always rendered, even
 * with one org, so "Add website" is discoverable.
 */
export function OrganizationSwitcher() {
  const t = useTranslations('ProductShell.switcher');
  const router = useRouter();
  const { organization } = useActiveOrganization();
  const organizations = useOrganizations();

  if (!organization) return null;

  const completed = organizations.filter((entry) => entry.setup_status === 'setup_complete');

  function handleChange(value: string) {
    if (value === ADD_WEBSITE) {
      router.push('/onboarding?new=1');
      return;
    }
    if (!organization || value === organization.id) return;
    setActiveOrganizationId(value);
    // Always land on /home: detail pages carry an entity of the old org.
    router.replace('/home');
  }

  return (
    <Select value={organization.id} onValueChange={handleChange}>
      <SelectTrigger
        aria-label={t('label')}
        className="h-auto border-0 bg-transparent px-5 py-2 shadow-none"
      >
        <span className="flex min-w-0 flex-col items-start text-left">
          <span className="w-full truncate font-medium text-sm">{labelOf(organization)}</span>
          <span className="w-full truncate text-muted-foreground text-xs">
            {hostOf(organization.website_url)}
          </span>
        </span>
      </SelectTrigger>
      <SelectContent>
        {completed.map((entry) => (
          <SelectItem key={entry.id} value={entry.id}>
            {labelOf(entry)}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={ADD_WEBSITE}>
          <Plus className="size-4" aria-hidden="true" />
          {t('addWebsite')}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
