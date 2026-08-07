'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken, getToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import {
  getActiveOrganization,
  OrganizationsApiError,
  useActiveOrganization,
} from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';

// Mirrors the onboarding scan-status poll (apps/web/app/[locale]/(authenticated)/onboarding/api.ts).
const ACTIVATION_POLL_INTERVAL_MS = 2000;
const ACTIVATION_POLL_TIMEOUT_MS = 30_000;

const TIERS = ['paid', 'expert'] as const;
type Tier = (typeof TIERS)[number];

type ActivationState = 'checking' | 'error' | 'idle' | 'timeout';
type CheckoutError = 'already_subscribed' | 'generic';

class CheckoutApiError extends Error {
  reason: CheckoutError | 'unauthorized';

  constructor(reason: CheckoutError | 'unauthorized') {
    super(reason);
    this.name = 'CheckoutApiError';
    this.reason = reason;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BillingPage() {
  const t = useTranslations('BillingPage');
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const [activationState, setActivationState] = useState<ActivationState>('idle');
  const [checkoutError, setCheckoutError] = useState<CheckoutError | null>(null);

  const goToLogin = useCallback(() => {
    clearToken();
    clearWorkspaceStatusCache();
    router.replace('/');
  }, [router]);

  const checkActivation = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setActivationState('checking');

      const expiresAt = Date.now() + ACTIVATION_POLL_TIMEOUT_MS;

      while (Date.now() <= expiresAt) {
        if (isCancelled()) return;

        try {
          const activeOrganization = await getActiveOrganization();

          if (isCancelled()) return;

          if (activeOrganization?.capabilities.keyword_research) {
            // The poll reads the API directly, so the cached org still carries
            // the pre-purchase capabilities — drop it before /home renders.
            await queryClient.invalidateQueries({
              queryKey: dashboardQueryKeys.organizations(),
            });
            router.replace('/home');
            return;
          }
        } catch (error) {
          if (isCancelled()) return;

          if (error instanceof OrganizationsApiError && error.reason === 'unauthorized') {
            goToLogin();
            return;
          }

          setActivationState('error');
          return;
        }

        await delay(ACTIVATION_POLL_INTERVAL_MS);
      }

      if (!isCancelled()) setActivationState('timeout');
    },
    [goToLogin, queryClient, router],
  );

  // The LemonSqueezy checkout redirect returns here with ?checkout=success; the
  // plan flip happens via webhook, which can lag the redirect, so poll until the
  // org's paid capability shows up (or give up after ~30s).
  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }

    if (new URLSearchParams(window.location.search).get('checkout') !== 'success') {
      return;
    }

    let cancelled = false;

    void checkActivation(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [checkActivation, router]);

  const checkoutMutation = useMutation({
    mutationFn: async (tier: Tier) => {
      if (!organization) throw new Error('organization_required');

      const response = await api.api.v0.billing.checkout.$post({
        json: { org_id: organization.id, tier },
      });
      const status = response.status as number;

      if (status === 401) {
        throw new CheckoutApiError('unauthorized');
      }

      if (status === 409) {
        throw new CheckoutApiError('already_subscribed');
      }

      if (!response.ok) {
        throw new CheckoutApiError('generic');
      }

      const { url } = await response.json();
      window.location.assign(url);
    },
    onError: (error) => {
      if (!(error instanceof CheckoutApiError)) {
        setCheckoutError('generic');
        return;
      }

      if (error.reason === 'unauthorized') {
        goToLogin();
        return;
      }

      setCheckoutError(error.reason);
    },
  });

  function startCheckout(tier: Tier) {
    setCheckoutError(null);
    checkoutMutation.mutate(tier);
  }

  if (activationState === 'checking') {
    return <StatusPanel>{t('activating.message')}</StatusPanel>;
  }

  if (activationState === 'timeout') {
    return (
      <StatusPanel>
        <p>{t('activating.timeout')}</p>
        <Button className="mt-3" onClick={() => router.replace('/home')}>
          {t('activating.continue')}
        </Button>
      </StatusPanel>
    );
  }

  if (activationState === 'error') {
    return (
      <StatusPanel tone="error">
        <p>{t('activating.error')}</p>
        <Button className="mt-3" onClick={() => void checkActivation()} variant="outline">
          {t('activating.retry')}
        </Button>
      </StatusPanel>
    );
  }

  if (organizationLoading || organizationError === 'unauthorized') {
    return <StatusPanel>{t('status.loading')}</StatusPanel>;
  }

  if (organizationError === 'no_organization') {
    return <StatusPanel tone="error">{t('status.noOrganization')}</StatusPanel>;
  }

  if (organizationError) {
    return <StatusPanel tone="error">{t('status.organizationError')}</StatusPanel>;
  }

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="font-semibold text-slate-950 text-xl">{t('title')}</h1>
        <p className="mt-1 text-slate-600 text-sm">{t('description')}</p>
      </div>

      {checkoutError ? (
        <StatusPanel tone="error">{t(`errors.${checkoutError}`)}</StatusPanel>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {TIERS.map((tier) => (
          <Card key={tier} className="border-slate-200 shadow-none">
            <CardHeader>
              <CardTitle>{t(`tiers.${tier}.name`)}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <p className="text-slate-600 text-sm">{t(`tiers.${tier}.description`)}</p>
              <Button
                disabled={!organization || checkoutMutation.isPending}
                onClick={() => startCheckout(tier)}
              >
                {checkoutMutation.isPending && checkoutMutation.variables === tier
                  ? t('redirecting')
                  : t(`tiers.${tier}.cta`)}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function StatusPanel({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'error' | 'neutral';
}) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        tone === 'neutral' && 'border-slate-200 bg-white text-slate-600',
      )}
    >
      {children}
    </div>
  );
}
