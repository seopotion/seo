'use client';

import { useTranslations } from 'next-intl';
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';

type WishlistFormProps = {
  source?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getTrackingFields() {
  const params = new URLSearchParams(window.location.search);

  return {
    utmSource: params.get('utm_source') ?? undefined,
    utmMedium: params.get('utm_medium') ?? undefined,
    utmCampaign: params.get('utm_campaign') ?? undefined,
    referrer: document.referrer || undefined,
  };
}

export function WishlistForm({ source = 'landing_page' }: WishlistFormProps) {
  const t = useTranslations('WishlistForm');
  const [email, setEmail] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const isLoading = status === 'loading';
  const showSuccess = status === 'success';
  const showError = status === 'error';

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setStatus('error');
      return;
    }

    setStatus('loading');

    try {
      const response = await fetch('/api/wishlist', {
        body: JSON.stringify({
          email: normalizedEmail,
          source,
          honeypot,
          ...getTrackingFields(),
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      const result = (await response.json()) as { ok?: boolean };

      if (!response.ok || !result.ok) {
        throw new Error('Wishlist signup failed.');
      }

      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <form className="flex flex-col gap-3 sm:flex-row" onSubmit={onSubmit}>
        <div className="absolute left-[-10000px] h-px w-px overflow-hidden">
          <label htmlFor={`${source}-website`}>{t('honeypotLabel')}</label>
          <input
            id={`${source}-website`}
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(event) => setHoneypot(event.target.value)}
          />
        </div>
        <Input
          type="email"
          name="email"
          placeholder={t('emailPlaceholder')}
          autoComplete="email"
          value={email}
          disabled={isLoading || showSuccess}
          aria-invalid={showError}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status === 'error') setStatus('idle');
          }}
          className="h-11 rounded-lg border-gray-200 bg-white px-4 text-gray-900 shadow-sm placeholder:text-gray-400"
        />
        <Button
          type="submit"
          disabled={isLoading || showSuccess}
          className="h-11 rounded-lg bg-orange-400 px-5 text-white shadow-sm hover:bg-orange-500 sm:min-w-40"
        >
          {isLoading ? t('joining') : t('submit')}
        </Button>
      </form>
      {showSuccess ? (
        <p className="mt-3 text-center text-green-700 text-sm">{t('success')}</p>
      ) : null}
      {showError ? <p className="mt-3 text-center text-red-600 text-sm">{t('error')}</p> : null}
    </div>
  );
}
