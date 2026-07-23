'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import type { ProductOrganization } from '@/lib/organizations';
import { cn } from '@/lib/utils';

export function BillingPanel({
  onUnauthorized,
  organization,
}: {
  onUnauthorized: () => void;
  organization: ProductOrganization | null;
}) {
  const t = useTranslations('SettingsPage.billing');
  const [portalError, setPortalError] = useState(false);
  const isPaid = Boolean(organization?.capabilities.keyword_research);

  const portalMutation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error('organization_required');

      const response = await api.api.v0.billing.portal.$post({
        json: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('portal_failed');
      }

      const { url } = await response.json();
      window.location.assign(url);
    },
    onError: (error) => {
      if (error instanceof Error && error.message === 'unauthorized') return;

      setPortalError(true);
    },
  });

  function openPortal() {
    setPortalError(false);
    portalMutation.mutate();
  }

  if (!isPaid) {
    return (
      <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
        <p className="text-slate-600 text-sm">{t('freeDescription')}</p>
        <Button asChild className="w-fit" size="sm" variant="outline">
          <Link href="/billing">{t('upgradeCta')}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-slate-200 bg-white p-4">
      {portalError ? <StatusPanel tone="error">{t('manageError')}</StatusPanel> : null}
      <p className="text-slate-600 text-sm">{t('description')}</p>
      <Button
        className="w-fit"
        disabled={!organization || portalMutation.isPending}
        onClick={openPortal}
        size="sm"
      >
        {portalMutation.isPending ? t('opening') : t('manage')}
      </Button>
    </div>
  );
}

function StatusPanel({ children, tone }: { children: ReactNode; tone: 'error' }) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
      )}
    >
      {children}
    </div>
  );
}
