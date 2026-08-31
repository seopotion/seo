'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { Button, Modal, StatusPanel } from '@/components/ui';
import { Link } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import {
  type ConnectedIntegration,
  GITHUB_RETURN_LOCALE_KEY,
  PUBLISH_ERROR_KEYS,
} from '@/lib/integrations';
import type { ProductOrganization } from '@/lib/organizations';

type InstallErrorKey = 'installFailed' | 'notConfigured';

/**
 * Everything the static-site connection needs: the explainer before we hand off
 * to github.com, and the connected state's reconnect / disconnect controls.
 */
export function StaticSiteDialog({
  dateFormatter,
  integration,
  needsReconnect,
  onClose,
  onDisconnected,
  onUnauthorized,
  open,
  organization,
}: {
  dateFormatter: Intl.DateTimeFormat;
  integration: ConnectedIntegration | null;
  needsReconnect: boolean;
  onClose: () => void;
  onDisconnected: () => void;
  onUnauthorized: () => void;
  open: boolean;
  organization: ProductOrganization | null;
}) {
  const t = useTranslations('SettingsPage.wordpress');
  const staticSiteT = useTranslations('SettingsPage.staticSite');
  const actionsT = useTranslations('SettingsPage.actions');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const titleId = useId();
  const [installing, setInstalling] = useState(false);
  const [installErrorKey, setInstallErrorKey] = useState<InstallErrorKey | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error('organization_required');

      const response = await api.api.v0.dashboard.integrations[':provider'].$delete({
        param: { provider: 'static-site' },
        query: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) throw new Error('static_site_disconnect_failed');
    },
    onSuccess: () => {
      setConfirmingDisconnect(false);
      if (organization) {
        void queryClient.invalidateQueries({
          queryKey: dashboardQueryKeys.connectedIntegrations(organization.id),
        });
      }
      // The connected body no longer applies, so the dialog cannot stay open.
      onDisconnected();
    },
  });

  const disconnectFailed =
    disconnectMutation.isError &&
    (disconnectMutation.error as Error | null)?.message !== 'unauthorized';

  /**
   * Connect and change-repository are the same hand-off: ask for an install URL
   * and leave for github.com. Reconfiguring an existing installation comes back
   * through the same callback, so there is nothing extra to do for a change.
   */
  async function startInstall() {
    if (!organization || installing) return;

    setInstalling(true);
    setInstallErrorKey(null);
    try {
      const res = await api.api.v0.dashboard.integrations.github['install-url'].$get({
        query: { org_id: organization.id },
      });

      if ((res.status as number) === 401) {
        onUnauthorized();
        return;
      }

      if (!res.ok) {
        // 503 until the App is registered for this environment — a deployment
        // gap, not something the user can fix by retrying.
        setInstallErrorKey((res.status as number) === 503 ? 'notConfigured' : 'installFailed');
        setInstalling(false);
        return;
      }

      window.sessionStorage.setItem(GITHUB_RETURN_LOCALE_KEY, locale);
      // Full-page navigation to GitHub — keep `installing` set, the page is leaving.
      window.location.href = (await res.json()).url;
    } catch {
      setInstallErrorKey('installFailed');
      setInstalling(false);
    }
  }

  function handleClose() {
    setInstallErrorKey(null);
    setConfirmingDisconnect(false);
    disconnectMutation.reset();
    onClose();
  }

  return (
    <Modal
      className="sm:h-auto sm:max-w-lg"
      closeLabel={actionsT('closeDialog')}
      labelledBy={titleId}
      onClose={handleClose}
      open={open}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-border border-b px-4 py-4 sm:px-6">
        <h2 id={titleId} className="min-w-0 font-semibold text-lg text-foreground">
          {staticSiteT('provider')}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={actionsT('closeDialog')}
          className="size-9"
          onClick={handleClose}
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </header>

      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto px-4 py-4 sm:px-6">
        {integration ? (
          <>
            {/* `owner/repo@branch`, built server-side. */}
            <p className="truncate font-medium text-foreground text-sm">{integration.target}</p>
            <p className="text-muted-foreground text-sm">
              {t('connectedOn', {
                date: dateFormatter.format(new Date(integration.connected_at)),
              })}
            </p>
            {integration.last_error ? (
              <StatusPanel tone="error">
                {staticSiteT(
                  PUBLISH_ERROR_KEYS[integration.last_error.code] ?? 'publishErrors.unknown',
                )}
              </StatusPanel>
            ) : null}
            {disconnectFailed ? (
              <StatusPanel tone="error">{staticSiteT('disconnectError')}</StatusPanel>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">{staticSiteT('description')}</p>
            <p className="text-muted-foreground text-sm">{staticSiteT('beforeRedirect')}</p>
          </>
        )}
        {/* Connecting only gets the files into their repo — rendering them is
            code they have to write, so the guide belongs in both states. */}
        <p className="text-muted-foreground text-sm">
          <Link
            className="font-medium text-warning underline underline-offset-2 hover:text-warning"
            href="/docs/custom-site"
            target="_blank"
          >
            {staticSiteT('setupGuide')}
          </Link>
        </p>
        {installErrorKey ? (
          <StatusPanel tone="error">{staticSiteT(`errors.${installErrorKey}`)}</StatusPanel>
        ) : null}
      </div>

      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-border border-t px-4 py-4 sm:px-6">
        {/* Same hand-off either way — only the label changes, because a dead
            installation is not something the user should have to guess is fixable. */}
        <Button
          type="button"
          data-modal-initial-focus
          disabled={!organization || installing || disconnectMutation.isPending}
          onClick={startInstall}
        >
          {installing
            ? staticSiteT('connecting')
            : !integration
              ? staticSiteT('connect')
              : needsReconnect
                ? staticSiteT('reconnect')
                : staticSiteT('changeRepository')}
        </Button>
        {integration ? (
          confirmingDisconnect ? (
            <>
              <Button
                type="button"
                variant="destructive"
                disabled={disconnectMutation.isPending}
                onClick={() => disconnectMutation.mutate()}
              >
                {staticSiteT('disconnectConfirmYes')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={disconnectMutation.isPending}
                onClick={() => setConfirmingDisconnect(false)}
              >
                {staticSiteT('disconnectCancel')}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="text-error hover:text-error"
              onClick={() => setConfirmingDisconnect(true)}
            >
              {staticSiteT('disconnect')}
            </Button>
          )
        ) : null}
        {confirmingDisconnect ? null : (
          <Button type="button" variant="ghost" onClick={handleClose}>
            {actionsT('close')}
          </Button>
        )}
      </footer>
    </Modal>
  );
}
