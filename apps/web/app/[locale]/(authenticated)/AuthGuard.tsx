'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { getToken } from '@/lib/auth';
import { clearWorkspaceStatusCache } from '@/lib/session';

const authGuardDisabled =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD === 'true';

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const t = useTranslations('AuthGuard');
  const [guardState, setGuardState] = useState<'authorized' | 'checking'>(
    authGuardDisabled ? 'authorized' : 'checking',
  );

  useEffect(() => {
    if (authGuardDisabled) return;

    if (!getToken()) {
      clearWorkspaceStatusCache();
      router.replace('/');
      return;
    }

    setGuardState('authorized');
  }, [router]);

  if (guardState !== 'authorized') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="font-medium text-slate-600 text-sm">{t('checkingSession')}</p>
      </main>
    );
  }

  return children;
}
