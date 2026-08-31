'use client';

import { useSearchParams } from 'next/navigation';
import { hasLocale, useLocale, useTranslations } from 'next-intl';
import { Suspense, useEffect, useRef, useState } from 'react';
import { Badge, Button, PageTitle } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { api } from '@/lib/api';
import { clearToken, getToken } from '@/lib/auth';
import { GSC_RETURN_LOCALE_KEY, type GscSite, matchGscProperty } from '@/lib/gsc';
import { cn } from '@/lib/utils';

type CallbackErrorKey = 'cancelled' | 'exchangeFailed' | 'siteFailed';

const GSC_CONSOLE_URL = 'https://search.google.com/search-console';
const SETTINGS_HREF = '/settings?tab=googleSearchConsole';

/**
 * GSC OAuth callback (#12). Google redirects here (unprefixed → rewritten to the
 * default locale) with ?code&state; we exchange the code server-side, the user
 * picks the property backing this org, then we return to Settings in the user's
 * original locale. No react-query here — this route is outside the (product) group.
 */
function CallbackInner() {
  const t = useTranslations('GscCallback');
  const router = useRouter();
  const currentLocale = useLocale();
  const params = useSearchParams();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [sites, setSites] = useState<GscSite[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [recommended, setRecommended] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<CallbackErrorKey | null>(null);
  const [saving, setSaving] = useState(false);
  // The OAuth code is single-use; guard against Strict Mode's double effect so
  // we never POST the same code to /connect twice.
  const exchanged = useRef(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    const code = params.get('code');
    const state = params.get('state');
    if (params.get('error') || !code || !state) {
      setErrorKey('cancelled');
      return;
    }
    if (exchanged.current) return;
    exchanged.current = true;
    void (async () => {
      const res = await api.api.v0.dashboard.gsc.connect.$post({ json: { code, state } });
      if ((res.status as number) === 401) {
        clearToken();
        router.replace('/');
        return;
      }
      if (!res.ok) {
        setErrorKey('exchangeFailed');
        return;
      }
      const body = await res.json();
      setOrgId(body.org_id);
      setSites(body.sites);
      // Preselect the property matching the org's website — a nicety, non-fatal.
      try {
        const orgsRes = await api.api.v0.core.organizations.$get();
        if (orgsRes.ok) {
          const { organizations } = await orgsRes.json();
          const org = organizations.find((candidate) => candidate.id === body.org_id);
          const match = org ? matchGscProperty(org.website_url, body.sites) : null;
          if (match) {
            setRecommended(match);
            setSelected(match);
          }
        }
      } catch {
        // Preselection failed; the picker still works, just without a default.
      }
    })();
  }, [params, router]);

  async function confirm() {
    if (!orgId || !selected || saving) return;
    setSaving(true);
    setErrorKey(null);
    const res = await api.api.v0.dashboard.gsc.site.$post({
      json: { org_id: orgId, site_url: selected },
    });
    if ((res.status as number) === 401) {
      clearToken();
      router.replace('/');
      return;
    }
    if (!res.ok) {
      setSaving(false);
      setErrorKey('siteFailed');
      return;
    }
    // sessionStorage is user-writable and can outlive a locale rename, so treat
    // anything we don't recognise as absent rather than routing to a dead prefix.
    const stored = window.sessionStorage.getItem(GSC_RETURN_LOCALE_KEY);
    const returnLocale = hasLocale(routing.locales, stored) ? stored : currentLocale;
    window.sessionStorage.removeItem(GSC_RETURN_LOCALE_KEY);
    router.replace(`${SETTINGS_HREF}&connected=1`, { locale: returnLocale });
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-md content-start gap-4 px-4 py-16">
      <div className="grid gap-4 rounded-lg border border-border bg-card p-6 shadow-sm">
        <PageTitle>{t('title')}</PageTitle>

        {errorKey ? (
          <>
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
              {t(`errors.${errorKey}`)}
            </p>
            <Button asChild variant="outline" className="w-fit">
              <Link href={SETTINGS_HREF}>{t('backToSettings')}</Link>
            </Button>
          </>
        ) : !sites ? (
          <p className="text-muted-foreground text-sm">{t('exchanging')}</p>
        ) : sites.length === 0 ? (
          <>
            <p className="text-muted-foreground text-sm">{t('noSites')}</p>
            <div className="flex flex-wrap gap-2">
              <Button asChild className="w-fit">
                <a href={GSC_CONSOLE_URL} rel="noopener noreferrer" target="_blank">
                  {t('openGsc')}
                </a>
              </Button>
              <Button asChild variant="outline" className="w-fit">
                <Link href={SETTINGS_HREF}>{t('backToSettings')}</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <div>
              <p className="font-medium text-foreground text-sm">{t('pickTitle')}</p>
              <p className="mt-1 text-muted-foreground text-sm">{t('pickBody')}</p>
            </div>
            <fieldset className="grid gap-2">
              <legend className="sr-only">{t('pickTitle')}</legend>
              {sites.map((site) => {
                const isSelected = selected === site.site_url;
                return (
                  <label
                    key={site.site_url}
                    className={cn(
                      'flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors',
                      isSelected
                        ? 'border-foreground bg-muted/50'
                        : 'border-border hover:border-border',
                      saving && 'cursor-not-allowed opacity-60',
                    )}
                  >
                    <input
                      type="radio"
                      name="gsc-property"
                      className="mt-1 size-4 accent-slate-900"
                      checked={isSelected}
                      disabled={saving}
                      onChange={() => setSelected(site.site_url)}
                    />
                    <span className="grid min-w-0 gap-0.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium text-foreground text-sm">
                          {site.site_url}
                        </span>
                        {recommended === site.site_url ? (
                          <Badge
                            variant="secondary"
                            className="border-transparent bg-emerald-100 text-emerald-700"
                          >
                            {t('recommended')}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="text-muted-foreground text-xs">{site.permission_level}</span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
            <Button
              type="button"
              className="w-fit"
              disabled={!selected || saving}
              onClick={confirm}
            >
              {saving ? t('saving') : t('confirm')}
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

// useSearchParams requires a Suspense boundary in the app router.
export default function GscCallbackPage() {
  return (
    <Suspense fallback={<main className="mx-auto max-w-md px-4 py-16" />}>
      <CallbackInner />
    </Suspense>
  );
}
