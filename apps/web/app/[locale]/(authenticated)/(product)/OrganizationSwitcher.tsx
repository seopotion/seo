'use client';

import { ChevronsUpDown, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { setActiveOrganizationId } from '@/lib/active-organization';
import {
  type ProductOrganization,
  useActiveOrganization,
  useOrganizations,
} from '@/lib/organizations';
import { cn } from '@/lib/utils';

// Sentinel select value: an action row, not an org.
const ADD_WEBSITE = '__add__';

/** Soft status pairings, the only ones that clear contrast on the monogram tile. */
const MONOGRAM_TONES = [
  'bg-success-muted text-success',
  'bg-info-muted text-info',
  'bg-warning-muted text-warning',
  'bg-progress-muted text-progress',
] as const;

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

/** Derived from the id, not the list position, so a website keeps its tone everywhere. */
function toneOf(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return MONOGRAM_TONES[Math.abs(hash) % MONOGRAM_TONES.length] ?? MONOGRAM_TONES[0];
}

function monogramOf(organization: ProductOrganization): string {
  return labelOf(organization).charAt(0).toUpperCase();
}

/**
 * Which of the user's orgs the product shell shows, pinned to the bottom of the
 * sidebar. A split control: the left half is a link into workspace settings, the
 * right button opens the list upward. Lists only completed orgs — an abandoned
 * scan is not somewhere the shell can land. Always rendered, even with one org,
 * so "Add website" is discoverable.
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
    <div className="mt-auto border-border border-t p-2">
      <Select value={organization.id} onValueChange={handleChange}>
        <div className="flex w-full items-center overflow-hidden rounded-md border border-border bg-background shadow-xs">
          <Link
            href="/settings"
            aria-label={t('settings')}
            className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 transition-colors hover:bg-accent"
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md font-semibold text-xs',
                toneOf(organization.id),
              )}
            >
              {monogramOf(organization)}
            </span>
            <span className="flex min-w-0 flex-col items-start text-left">
              <span className="w-full truncate font-semibold text-sm">{labelOf(organization)}</span>
              <span className="w-full truncate text-muted-foreground text-xs">
                {hostOf(organization.website_url)}
              </span>
            </span>
          </Link>
          <SelectTrigger
            aria-label={t('label')}
            icon={<ChevronsUpDown className="size-4" />}
            // The outer overflow-hidden clips an outset ring, so focus draws inside.
            className="h-12 w-9 shrink-0 justify-center rounded-none border-0 border-border border-l bg-muted/50 px-0 text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:inset-ring-2 focus-visible:inset-ring-ring focus-visible:ring-0"
          />
        </div>
        <SelectContent
          side="top"
          align="end"
          // +4px from the popper's data-[side=top] translate, for the 6px the design asks for.
          sideOffset={2}
          // The width of the control itself: the 13.5rem sidebar less its 0.5rem padding.
          className="w-50 shadow-lg"
        >
          <SelectGroup>
            <SelectLabel>{t('switchTo')}</SelectLabel>
            {completed.map((entry) => (
              <SelectItem key={entry.id} value={entry.id} className="gap-2.5 [&_svg]:text-success">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded font-semibold text-[10px]',
                    toneOf(entry.id),
                  )}
                >
                  {monogramOf(entry)}
                </span>
                <span className="flex min-w-0 flex-col items-start text-left">
                  <span className="w-full truncate font-medium">{labelOf(entry)}</span>
                  <span className="w-full truncate text-muted-foreground text-xs">
                    {hostOf(entry.website_url)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectSeparator />
          <SelectItem value={ADD_WEBSITE} className="font-medium">
            <Plus className="size-4" aria-hidden="true" />
            {t('addWebsite')}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
