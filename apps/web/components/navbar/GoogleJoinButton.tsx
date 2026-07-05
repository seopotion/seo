'use client';

import Script from 'next/script';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useRouter } from '@/i18n/navigation';
import { getPostLoginPath } from '../../lib/session';
import { GOOGLE_IDENTITY_SCRIPT_SRC, useGoogleLogin } from '../auth/useGoogleLogin';
import { Button } from '../ui';

function GoogleIcon() {
  return (
    <span className="flex size-5 items-center justify-center rounded-full bg-white">
      <svg aria-hidden="true" className="size-3.5" viewBox="0 0 24 24">
        <path
          d="M21.805 10.023h-9.58v3.954h5.514c-.238 1.273-.96 2.35-2.044 3.075v2.553h3.31c1.938-1.785 3.054-4.414 3.054-7.53 0-.713-.064-1.4-.254-2.052z"
          fill="#4285F4"
        />
        <path
          d="M12.225 22c2.765 0 5.087-.916 6.78-2.482l-3.31-2.553c-.916.614-2.088.977-3.47.977-2.67 0-4.93-1.802-5.738-4.225H3.061v2.636C4.746 19.697 8.209 22 12.225 22z"
          fill="#34A853"
        />
        <path
          d="M6.487 13.717a5.885 5.885 0 0 1 0-3.764V7.317H3.061a10.003 10.003 0 0 0 0 9.036l3.426-2.636z"
          fill="#FBBC05"
        />
        <path
          d="M12.225 6.028c1.504 0 2.855.517 3.916 1.532l2.938-2.938C17.302 2.967 14.98 2 12.225 2 8.209 2 4.746 4.303 3.061 7.317l3.426 2.636c.808-2.423 3.068-3.925 5.738-3.925z"
          fill="#EA4335"
        />
      </svg>
    </span>
  );
}

export function GoogleJoinButton() {
  const router = useRouter();
  const t = useTranslations('GoogleJoinButton');
  const [scriptReady, setScriptReady] = useState(false);

  async function onLoggedIn() {
    const path = await getPostLoginPath();
    if (path) router.push(path);
  }

  const { initialize, isConfigured, prompt } = useGoogleLogin({
    onLoggedIn: () => void onLoggedIn(),
  });

  function onScriptReady() {
    setScriptReady(initialize());
  }

  const title = !isConfigured ? t('notConfigured') : !scriptReady ? t('loading') : undefined;

  return (
    <>
      <Script
        src={GOOGLE_IDENTITY_SCRIPT_SRC}
        strategy="afterInteractive"
        onReady={onScriptReady}
      />
      <Button
        className="min-w-38.5 bg-orange-400 text-white hover:bg-orange-500"
        onClick={prompt}
        title={title}
      >
        <GoogleIcon />
        {t('label')}
      </Button>
    </>
  );
}
