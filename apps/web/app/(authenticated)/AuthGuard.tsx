'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { getToken } from '../../lib/auth';

const authGuardDisabled =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD === 'true';

export function AuthGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(authGuardDisabled);

  useEffect(() => {
    if (authGuardDisabled) return;

    if (!getToken()) {
      router.replace('/');
      return;
    }

    setAuthorized(true);
  }, [router]);

  if (!authorized) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <p className="font-medium text-slate-600 text-sm">Checking your session...</p>
      </main>
    );
  }

  return children;
}
