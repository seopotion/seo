'use client';

import { useCallback, useState } from 'react';
import { api } from '../../lib/api';
import { setToken } from '../../lib/auth';

export const GOOGLE_IDENTITY_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '';

type UseGoogleLoginOptions = {
  onLoggedIn: () => Promise<void> | void;
  onLoginError?: () => void;
  onLoginStart?: () => void;
};

export function useGoogleLogin({ onLoggedIn, onLoginError, onLoginStart }: UseGoogleLoginOptions) {
  const [isInitialized, setIsInitialized] = useState(false);

  const handleCredential = useCallback(
    async (response: GoogleCredentialResponse) => {
      onLoginStart?.();

      try {
        const res = await api.api.v0.core.login.$post({
          json: { id_token: response.credential },
        });

        if (!res.ok) {
          onLoginError?.();
          return;
        }

        const { token } = await res.json();
        setToken(token);
        await onLoggedIn();
      } catch {
        onLoginError?.();
      }
    },
    [onLoggedIn, onLoginError, onLoginStart],
  );

  const initialize = useCallback(() => {
    if (!window.google || !CLIENT_ID) return false;

    window.google.accounts.id.initialize({
      callback: handleCredential,
      client_id: CLIENT_ID,
    });
    setIsInitialized(true);
    return true;
  }, [handleCredential]);

  const prompt = useCallback(() => {
    if (!initialize() || !window.google) return;

    window.google.accounts.id.prompt();
  }, [initialize]);

  return {
    initialize,
    isConfigured: Boolean(CLIENT_ID),
    isInitialized,
    prompt,
  };
}
