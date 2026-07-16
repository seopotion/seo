'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { clearToken, getToken } from '@/lib/auth';
import {
  clearWorkspaceStatusCache,
  getCachedWorkspaceStatus,
  getWorkspaceStatus,
} from '@/lib/session';

const authGuardDisabled =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD === 'true';

export function ProductAccessGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('AuthGuard');
  const [guardState, setGuardState] = useState<'authorized' | 'checking' | 'error'>(() => {
    if (authGuardDisabled) return 'authorized';
    return getCachedWorkspaceStatus()?.setupComplete ? 'authorized' : 'checking';
  });

  const checkProductAccess = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      if (authGuardDisabled) {
        setGuardState('authorized');
        return;
      }

      const cachedStatus = getCachedWorkspaceStatus();

      if (cachedStatus?.setupComplete) {
        setGuardState('authorized');
        return;
      }

      setGuardState('checking');

      if (!getToken()) {
        clearWorkspaceStatusCache();
        router.replace('/');
        return;
      }

      const status = await getWorkspaceStatus();

      if (isCancelled()) return;

      if (!status.ok) {
        if (status.reason === 'unauthorized') {
          clearToken();
          clearWorkspaceStatusCache();
          router.replace('/');
          return;
        }

        setGuardState('error');
        return;
      }

      if (!status.setupComplete) {
        router.replace('/onboarding', { locale });
        return;
      }

      setGuardState('authorized');
    },
    [locale, router],
  );

  useEffect(() => {
    let cancelled = false;

    void checkProductAccess(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [checkProductAccess]);

  if (guardState === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
        <p className="font-medium text-slate-600 text-sm">{t('workspaceError')}</p>
        <Button onClick={() => void checkProductAccess()} variant="outline">
          {t('retry')}
        </Button>
      </main>
    );
  }

  if (guardState !== 'authorized') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="font-medium text-slate-600 text-sm">{t('checkingWorkspace')}</p>
      </main>
    );
  }

  return children;
}
