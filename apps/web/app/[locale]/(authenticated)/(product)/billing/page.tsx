'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, StatusPanel } from '@/components/ui';
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
import { ManageSubscriptionCard } from './_components/ManageSubscriptionCard';
import {
  hasPurchasableTier,
  isActivated,
  parsePurchasedTier,
  TIERS,
  type Tier,
  tierState,
} from './tiers';

// Mirrors the onboarding scan-status poll (apps/web/app/[locale]/(authenticated)/onboarding/api.ts).
const ACTIVATION_POLL_INTERVAL_MS = 2000;
const ACTIVATION_POLL_TIMEOUT_MS = 30_000;

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

type AppliedPromo = {
  code: string;
  percent: number;
  duration: 'once' | 'repeating' | 'forever';
  duration_in_months?: number;
};
type PromoReason =
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'exhausted'
  | 'already_redeemed'
  | 'generic';

class PromoApiError extends Error {
  reason: PromoReason | 'unauthorized';
  constructor(reason: PromoReason | 'unauthorized') {
    super(reason);
    this.name = 'PromoApiError';
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
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<AppliedPromo | null>(null);
  const [promoError, setPromoError] = useState<PromoReason | null>(null);

  const goToLogin = useCallback(() => {
    clearToken();
    clearWorkspaceStatusCache();
    router.replace('/');
  }, [router]);

  const checkActivation = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      setActivationState('checking');

      // Which tier the provider says was bought. Read here rather than passed in
      // so the retry button polls for the same thing the redirect did — the
      // param stays on the URL until we navigate away.
      const purchasedTier = parsePurchasedTier(
        new URLSearchParams(window.location.search).get('tier'),
      );

      const expiresAt = Date.now() + ACTIVATION_POLL_TIMEOUT_MS;

      while (Date.now() <= expiresAt) {
        if (isCancelled()) return;

        try {
          const activeOrganization = await getActiveOrganization();

          if (isCancelled()) return;

          if (isActivated(activeOrganization, purchasedTier)) {
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

  // The LemonSqueezy checkout redirect returns here with ?checkout=success&tier=…;
  // the plan flip happens via webhook, which can lag the redirect, so poll until
  // the org reaches the purchased tier (or give up after ~30s).
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

  const promoMutation = useMutation({
    mutationFn: async (code: string): Promise<AppliedPromo> => {
      if (!organization) throw new Error('organization_required');
      const response = await api.api.v0.billing.promo.validate.$post({
        json: { org_id: organization.id, code },
      });
      const status = response.status as number;
      if (status === 401) throw new PromoApiError('unauthorized');
      if (status === 422) {
        const body = (await response.json()) as { reason: PromoReason };
        throw new PromoApiError(body.reason);
      }
      if (!response.ok) throw new PromoApiError('generic');
      return (await response.json()) as AppliedPromo;
    },
    onSuccess: (promo) => {
      setAppliedPromo(promo);
      setPromoInput('');
      setPromoError(null);
    },
    onError: (error) => {
      if (error instanceof PromoApiError) {
        if (error.reason === 'unauthorized') {
          goToLogin();
          return;
        }
        setPromoError(error.reason);
        return;
      }
      setPromoError('generic');
    },
  });

  function discountLabel(promo: AppliedPromo): string {
    return t(`promo.discount.${promo.duration}`, {
      percent: promo.percent,
      months: promo.duration_in_months ?? 0,
    });
  }

  const checkoutMutation = useMutation({
    mutationFn: async (tier: Tier) => {
      if (!organization) throw new Error('organization_required');

      const response = await api.api.v0.billing.checkout.$post({
        json: { org_id: organization.id, tier, promo_code: appliedPromo?.code },
      });
      const status = response.status as number;

      if (status === 401) {
        throw new CheckoutApiError('unauthorized');
      }

      if (status === 409) {
        throw new CheckoutApiError('already_subscribed');
      }

      if (status === 422) {
        const body = (await response.json()) as { reason: PromoReason };
        setAppliedPromo(null);
        throw new PromoApiError(body.reason);
      }

      if (!response.ok) {
        throw new CheckoutApiError('generic');
      }

      const { url } = await response.json();
      window.location.assign(url);
    },
    onError: (error) => {
      if (error instanceof PromoApiError) {
        if (error.reason === 'unauthorized') {
          goToLogin();
          return;
        }

        setPromoError(error.reason);
        return;
      }

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
    setPromoError(null);
    checkoutMutation.mutate(tier);
  }

  const currentTier = organization?.billing_tier ?? 'free';
  const isSubscribed = Boolean(organization?.capabilities.keyword_research);

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
        <h1 className="font-semibold text-foreground text-xl">
          {isSubscribed ? t('subscribedTitle') : t('title')}
        </h1>
        <p className="mt-1 text-muted-foreground text-sm">
          {isSubscribed ? t('subscribedDescription') : t('description')}
        </p>
      </div>

      {checkoutError ? (
        <StatusPanel tone="error">{t(`errors.${checkoutError}`)}</StatusPanel>
      ) : null}

      {isSubscribed ? (
        <ManageSubscriptionCard onUnauthorized={goToLogin} organization={organization} />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {TIERS.map((tier) => {
          const state = tierState(currentTier, tier);

          return (
            <Card key={tier} className="border-border shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {t(`tiers.${tier}.name`)}
                  {state === 'upgrade' ? null : (
                    <span className="rounded-full bg-success-muted px-2 py-0.5 font-medium text-success text-xs">
                      {t(`tierState.${state}`)}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <p className="text-muted-foreground text-sm">{t(`tiers.${tier}.description`)}</p>
                {state === 'upgrade' ? (
                  <Button
                    disabled={!organization || checkoutMutation.isPending}
                    onClick={() => startCheckout(tier)}
                  >
                    {checkoutMutation.isPending && checkoutMutation.variables === tier
                      ? t('redirecting')
                      : t(`tiers.${tier}.cta`)}
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {hasPurchasableTier(currentTier) ? (
        <Card className="border-border shadow-none">
          <CardContent className="grid gap-2 pt-6">
            <p className="font-medium text-foreground text-sm">{t('promo.title')}</p>
            {appliedPromo ? (
              <div className="flex items-center justify-between rounded-md border border-success-border bg-success-subtle px-3 py-2 text-success text-sm">
                <span>
                  {t('promo.applied', {
                    code: appliedPromo.code,
                    discount: discountLabel(appliedPromo),
                  })}
                </span>
                <Button
                  onClick={() => {
                    setAppliedPromo(null);
                    setPromoError(null);
                  }}
                  size="sm"
                  variant="ghost"
                >
                  {t('promo.remove')}
                </Button>
              </div>
            ) : (
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (promoInput.trim() !== '') promoMutation.mutate(promoInput);
                }}
              >
                <input
                  className="w-48 rounded-md border border-border px-3 py-1.5 text-sm uppercase"
                  onChange={(event) => setPromoInput(event.target.value)}
                  placeholder={t('promo.placeholder')}
                  value={promoInput}
                />
                <Button
                  disabled={promoMutation.isPending || promoInput.trim() === ''}
                  type="submit"
                  variant="outline"
                >
                  {promoMutation.isPending ? t('promo.applying') : t('promo.apply')}
                </Button>
              </form>
            )}
            {promoError ? (
              <p className="text-error text-sm">{t(`promo.errors.${promoError}`)}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
