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

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
        fill="#EA4335"
      />
    </svg>
  );
}

export function GoogleJoinButton() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('GoogleJoinButton');
  const containerRef = useRef<HTMLDivElement>(null);
  const mobileContainerRef = useRef<HTMLDivElement>(null);
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
    if (!isConfigured || !initialize() || !window.google) return;
    if (!containerRef.current || !mobileContainerRef.current) return;

    containerRef.current.replaceChildren();
    window.google.accounts.id.renderButton(containerRef.current, {
      shape: 'pill',
      size: 'large',
      text: 'signup_with',
      theme: 'outline',
      width: 190,
    });

    // Google's button text can't be customized to just "Sign Up", so on mobile we
    // render it invisibly and overlay our own pill on top to capture the click.
    mobileContainerRef.current.replaceChildren();
    window.google.accounts.id.renderButton(mobileContainerRef.current, {
      shape: 'pill',
      size: 'large',
      text: 'signup_with',
      theme: 'outline',
      width: 128,
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
      <div
        className={showRenderedButton ? 'hidden min-h-10 sm:block' : 'hidden min-h-10'}
        ref={containerRef}
      />
      <div className={showRenderedButton ? 'relative inline-flex h-10 w-32 sm:hidden' : 'hidden'}>
        <span className="pointer-events-none inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-input bg-background px-4 font-semibold text-sm shadow-xs">
          <GoogleIcon className="size-4" />
          {t('signUp')}
        </span>
        <div className="absolute inset-0 overflow-hidden opacity-0" ref={mobileContainerRef} />
      </div>
      {errorLabel ? (
        <p className="max-w-44 text-right text-red-600 text-xs leading-snug">{errorLabel}</p>
      ) : null}
    </div>
  );
}
