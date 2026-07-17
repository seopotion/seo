'use client';

import Script from 'next/script';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { clearToken } from '../../lib/auth';
import { clearWorkspaceStatusCache, getWorkspaceStatus } from '../../lib/session';
import { GOOGLE_IDENTITY_SCRIPT_SRC, useGoogleLogin } from '../auth/useGoogleLogin';
import { Button } from '../ui';

type AuthPhase = 'idle' | 'signingIn' | 'checkingWorkspace';
type AuthError = 'signIn' | 'workspace' | null;

export function GoogleJoinButton() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('GoogleJoinButton');
  const containerRef = useRef<HTMLDivElement>(null);
  const [authError, setAuthError] = useState<AuthError>(null);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('idle');
  const [scriptReady, setScriptReady] = useState(false);

  const checkWorkspace = useCallback(async () => {
    setAuthError(null);
    setAuthPhase('checkingWorkspace');

    const status = await getWorkspaceStatus();

    if (!status.ok) {
      if (status.reason === 'unauthorized') {
        clearToken();
        clearWorkspaceStatusCache();
        setAuthError('signIn');
      } else {
        setAuthError('workspace');
      }

      setAuthPhase('idle');
      return;
    }

    router.push(status.path, { locale });
  }, [locale, router]);

  const { initialize, isConfigured } = useGoogleLogin({
    onLoggedIn: checkWorkspace,
    onLoginError: () => {
      setAuthPhase('idle');
      setAuthError('signIn');
    },
    onLoginStart: () => {
      setAuthError(null);
      setAuthPhase('signingIn');
    },
  });

  const renderGoogleButton = useCallback(() => {
    if (!isConfigured || !initialize() || !window.google || !containerRef.current) return;

    containerRef.current.replaceChildren();
    window.google.accounts.id.renderButton(containerRef.current, {
      shape: 'pill',
      size: 'large',
      text: 'signup_with',
      theme: 'outline',
      width: 190,
    });
    setScriptReady(true);
  }, [initialize, isConfigured]);

  const showRenderedButton = isConfigured && scriptReady && authPhase === 'idle';
  const busyLabel =
    authPhase === 'signingIn'
      ? t('signingIn')
      : authPhase === 'checkingWorkspace'
        ? t('checkingWorkspace')
        : null;
  const errorLabel =
    authError === 'signIn'
      ? t('signInError')
      : authError === 'workspace'
        ? t('workspaceError')
        : null;

  const fallbackLabel = !isConfigured ? t('notConfigured') : t('loading');

  return (
    <div className="flex min-w-40 flex-col items-end gap-1">
      <Script
        src={GOOGLE_IDENTITY_SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={renderGoogleButton}
      />
      {busyLabel ? (
        <Button className="min-w-40" disabled>
          {busyLabel}
        </Button>
      ) : authError === 'workspace' ? (
        <Button className="min-w-40" onClick={() => void checkWorkspace()} variant="outline">
          {t('retry')}
        </Button>
      ) : !showRenderedButton ? (
        <Button className="min-w-40" disabled variant="outline">
          {fallbackLabel}
        </Button>
      ) : null}
      <div className={showRenderedButton ? 'min-h-10' : 'hidden min-h-10'} ref={containerRef} />
      {errorLabel ? (
        <p className="max-w-44 text-right text-red-600 text-xs leading-snug">{errorLabel}</p>
      ) : null}
    </div>
  );
}
