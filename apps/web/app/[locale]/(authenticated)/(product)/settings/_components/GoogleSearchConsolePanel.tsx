'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, StatusPanel } from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { GSC_RETURN_LOCALE_KEY, useGscStatus } from '@/lib/gsc';
import type { ProductOrganization } from '@/lib/organizations';

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

      <div className="grid gap-4 rounded-md border border-border bg-card p-4">
        <p className="text-muted-foreground text-sm">{t('description')}</p>

        {statusQuery.isPending ? (
          <p className="text-muted-foreground text-sm">{t('statusLoading')}</p>
        ) : statusQuery.isError ? (
          <StatusPanel tone="error">{t('statusError')}</StatusPanel>
        ) : status?.connected ? (
          <div className="grid gap-3">
            <Badge variant="success" className="w-fit">
              {t('badges.connected')}
            </Badge>
            <dl className="grid gap-2 text-sm">
              <div className="grid gap-0.5">
                <dt className="text-muted-foreground text-xs">{t('connectedAccount')}</dt>
                <dd className="truncate text-foreground">{status.google_email}</dd>
              </div>
              <div className="grid gap-0.5">
                <dt className="text-muted-foreground text-xs">{t('property')}</dt>
                <dd className="truncate text-foreground">{status.site_url}</dd>
              </div>
            </dl>
            {status.connected_at ? (
              <p className="text-muted-foreground text-xs">
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
                  <span className="text-muted-foreground text-sm">{t('disconnectConfirm')}</span>
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
                  className="w-fit text-error hover:text-error"
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
            <ul className="grid gap-2 text-muted-foreground text-sm">
              <li className="flex items-start gap-2">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                {t('benefit1')}
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
                {t('benefit2')}
              </li>
            </ul>
            <p className="text-muted-foreground text-xs">{t('readOnlyNote')}</p>
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
