'use client';

import Script from 'next/script';
import { useRef } from 'react';
import { GOOGLE_IDENTITY_SCRIPT_SRC, useGoogleLogin } from './auth/useGoogleLogin';

type LoginButtonProps = {
  onLoggedIn: () => void;
  buttonOptions?: GoogleButtonOptions;
  className?: string;
};

/**
 * "Sign in with Google" via Google Identity Services. On success we receive a
 * Google ID token, exchange it at POST /core/login for our session JWT, store
 * it, and notify the parent.
 */
export function LoginButton({ onLoggedIn, buttonOptions, className }: LoginButtonProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { initialize } = useGoogleLogin({ onLoggedIn });

  function renderGoogleButton() {
    if (!initialize() || !window.google || !containerRef.current) return;

    containerRef.current.replaceChildren();
    window.google.accounts.id.renderButton(containerRef.current, {
      theme: 'outline',
      size: 'large',
      ...buttonOptions,
    });
  }

  return (
    <>
      <Script
        src={GOOGLE_IDENTITY_SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={renderGoogleButton}
      />
      <div className={className} ref={containerRef} />
    </>
  );
}
