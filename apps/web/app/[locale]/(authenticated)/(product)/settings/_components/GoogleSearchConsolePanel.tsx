'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, CheckCircle2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { GSC_RETURN_LOCALE_KEY, useGscStatus } from '@/lib/gsc';
import type { ProductOrganization } from '@/lib/organizations';
import { cn } from '@/lib/utils';

/**
 * Settings → Google Search Console (#12). Drives the OAuth connect flow: the
 * connect/reconnect/change buttons all fetch a consent URL and hand off to
 * Google (the callback page finishes the round-trip). Status is a DB-only read.
 */
export function GoogleSearchConsolePanel({
  onUnauthorized,
  organization,
}: {
  onUnauthorized: () => void;
  organization: ProductOrganization | null;
}) {
  const t = useTranslations('SettingsPage.googleSearchConsole');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [justConnected, setJustConnected] = useState(false);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  const statusQuery = useGscStatus(organization, { onUnauthorized });
  const status = statusQuery.data;

  // One-time success banner after the callback redirects back with ?connected=1;
  // strip the param so a refresh/back doesn't replay it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') !== '1') return;
    setJustConnected(true);
    if (organization) {
      void queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.gscStatus(organization.id),
      });
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.home(organization.id) });
    }
    params.delete('connected');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [organization, queryClient]);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error('organization_required');

      const response = await api.api.v0.dashboard.gsc.$delete({
        query: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) throw new Error('gsc_disconnect_failed');

      return response.json();
    },
    onSuccess: () => {
      setConfirmingDisconnect(false);
      if (!organization) return;
      void queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.gscStatus(organization.id),
      });
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.home(organization.id) });
    },
  });

  const disconnectFailed =
    disconnectMutation.isError &&
    (disconnectMutation.error as Error | null)?.message !== 'unauthorized';

  // Connect, reconnect and change-account all funnel through the same handoff:
  // fetch a signed consent URL, remember the locale for the return trip, leave.
  async function startConnect() {
    if (!organization || connecting) return;

    setConnecting(true);
    setConnectError(false);
    try {
      const res = await api.api.v0.dashboard.gsc['auth-url'].$get({
        query: { org_id: organization.id },
      });

      if ((res.status as number) === 401) {
        onUnauthorized();
        return;
      }

      if (!res.ok) {
        setConnectError(true);
        setConnecting(false);
        return;
      }

      window.sessionStorage.setItem(GSC_RETURN_LOCALE_KEY, locale);
      // Full-page navigation to Google consent — keep `connecting` set, the page is leaving.
      window.location.href = (await res.json()).url;
    } catch {
      setConnectError(true);
      setConnecting(false);
    }
  }

  const connectButtonDisabled = !organization || connecting;

  return (
    <div className="grid gap-4">
      {justConnected ? <StatusPanel tone="success">{t('connectedSuccess')}</StatusPanel> : null}

      <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-slate-900 text-white">
            <BarChart3 aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-slate-950 text-sm">{t('title')}</p>
            <p className="mt-0.5 text-slate-500 text-sm">{t('description')}</p>
          </div>
        </div>

        {statusQuery.isPending ? (
          <p className="text-slate-500 text-sm">{t('statusLoading')}</p>
        ) : statusQuery.isError ? (
          <StatusPanel tone="error">{t('statusError')}</StatusPanel>
        ) : status?.connected ? (
          <div className="grid gap-3">
            <Badge
              variant="secondary"
              className="w-fit border-transparent bg-emerald-100 text-emerald-700"
            >
              {t('badges.connected')}
            </Badge>
            <dl className="grid gap-2 text-sm">
              <div className="grid gap-0.5">
                <dt className="text-slate-500 text-xs">{t('connectedAccount')}</dt>
                <dd className="truncate text-slate-950">{status.google_email}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-slate-500 text-xs">{t('property')}</dt>
                <dd className="truncate text-slate-950">{status.site_url}</dd>
              </div>
            </dl>
            {status.connected_at ? (
              <p className="text-slate-500 text-xs">
                {t('connectedOn', { date: dateFormatter.format(new Date(status.connected_at)) })}
              </p>
            ) : null}

            {disconnectFailed ? (
              <StatusPanel tone="error">{t('disconnectError')}</StatusPanel>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={connectButtonDisabled}
                onClick={startConnect}
              >
                {connecting ? t('connecting') : t('changeConnection')}
              </Button>
              {confirmingDisconnect ? (
                <>
                  <span className="text-slate-600 text-sm">{t('disconnectConfirm')}</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={disconnectMutation.isPending}
                    onClick={() => disconnectMutation.mutate()}
                  >
                    {t('disconnectConfirmYes')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={disconnectMutation.isPending}
                    onClick={() => setConfirmingDisconnect(false)}
                  >
                    {t('disconnectCancel')}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit text-red-600 hover:text-red-700"
                  onClick={() => setConfirmingDisconnect(true)}
                >
                  {t('disconnect')}
                </Button>
              )}
            </div>
          </div>
        ) : status?.needs_reconnect ? (
          <div className="grid gap-3">
            <StatusPanel tone="warning">{t('reconnectNeeded')}</StatusPanel>
            <Button
              type="button"
              className="w-fit"
              disabled={connectButtonDisabled}
              onClick={startConnect}
            >
              {connecting ? t('connecting') : t('reconnect')}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <ul className="grid gap-2 text-slate-600 text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                {t('benefit1')}
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                {t('benefit2')}
              </li>
            </ul>
            <p className="text-slate-500 text-xs">{t('readOnlyNote')}</p>
            <Button
              type="button"
              className="w-fit"
              disabled={connectButtonDisabled}
              onClick={startConnect}
            >
              {connecting ? t('connecting') : t('connect')}
            </Button>
          </div>
        )}

        {connectError ? <StatusPanel tone="error">{t('connectError')}</StatusPanel> : null}
      </div>
    </div>
  );
}

function StatusPanel({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'error' | 'success' | 'warning';
}) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-800',
      )}
    >
      {children}
    </div>
  );
}
