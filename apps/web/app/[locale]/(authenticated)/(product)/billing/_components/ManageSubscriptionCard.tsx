'use client';

import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import type { ProductOrganization } from '@/lib/organizations';
import { cn } from '@/lib/utils';

/** Portal entry point for an org that already has a subscription. The page
 * renders this only when `capabilities.keyword_research` is true. */
export function ManageSubscriptionCard({
  onUnauthorized,
  organization,
}: {
  onUnauthorized: () => void;
  organization: ProductOrganization | null;
}) {
  const t = useTranslations('BillingPage.manage');
  const [portalError, setPortalError] = useState(false);

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

  return (
    <div className="grid gap-3 rounded-md border border-border bg-card p-4">
      {portalError ? <StatusPanel tone="error">{t('error')}</StatusPanel> : null}
      <p className="text-muted-foreground text-sm">{t('description')}</p>
      <Button
        className="w-fit"
        disabled={!organization || portalMutation.isPending}
        onClick={openPortal}
        size="sm"
      >
        {portalMutation.isPending ? t('opening') : t('open')}
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
