'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Input,
  Label,
  StatusPanel,
} from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { cn } from '@/lib/utils';

type WordPressErrorKey = 'connectFailed' | 'invalidToken' | 'pluginNotConfigured' | 'requestFailed';
type FailedStep = 1 | 2 | null;
type ConnectError = { key: WordPressErrorKey; step: FailedStep };

const REQUEST_FAILED_ERROR: ConnectError = { key: 'requestFailed', step: 1 };

function mapErrorCode(errorCode: string | undefined): ConnectError {
  switch (errorCode) {
    case 'wordpress_request_failed':
      return REQUEST_FAILED_ERROR;
    case 'integration_not_configured':
      return { key: 'pluginNotConfigured', step: 2 };
    case 'invalid_integration_key':
      return { key: 'invalidToken', step: 2 };
    default:
      return { key: 'connectFailed', step: null };
  }
}

/**
 * The WordPress setup steps, which used to be the integrations tab's permanent
 * body. `replacing` is gone as state: the dialog itself is the toggle, and
 * `isConnected` only picks which description line to show.
 */
export function WordPressDialog({
  isConnected,
  onClose,
  onConnected,
  onUnauthorized,
  open,
  organizationId,
  siteUrl,
}: {
  isConnected: boolean;
  onClose: () => void;
  onConnected: () => void;
  onUnauthorized: () => void;
  open: boolean;
  organizationId: string | null;
  siteUrl: string;
}) {
  const t = useTranslations('SettingsPage.wordpress');
  const actionsT = useTranslations('SettingsPage.actions');
  const queryClient = useQueryClient();
  const tokenRef = useRef<HTMLInputElement>(null);
  const [token, setToken] = useState('');
  const [connectError, setConnectError] = useState<ConnectError | null>(null);

  const normalizedSiteUrl = siteUrl.replace(/\/+$/, '');

  const connectMutation = useMutation({
    mutationFn: async () => {
      if (!organizationId) throw new Error('organization_required');

      const response = await api.api.v0.dashboard.integrations.wordpress.$post({
        json: { org_id: organizationId, token: token.trim() },
      });

      if ((response.status as number) === 401) {
        onUnauthorized();
        throw new Error('unauthorized');
      }

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false as const,
          errorCode: 'error_code' in data ? data.error_code : undefined,
        };
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (!result.success) {
        setConnectError(mapErrorCode(result.errorCode));
        return;
      }

      if (organizationId) {
        const connectedIntegrationsKey = dashboardQueryKeys.connectedIntegrations(organizationId);
        void queryClient.invalidateQueries({ queryKey: connectedIntegrationsKey });
      }

      setToken('');
      setConnectError(null);
      // The dialog closes on success, so the green banner belongs to the panel.
      onConnected();
    },
    onError: (error) => {
      if (
        error instanceof Error &&
        (error.message === 'unauthorized' || error.message === 'organization_required')
      ) {
        return;
      }

      setConnectError(REQUEST_FAILED_ERROR);
    },
  });

  function handleConnect() {
    if (!organizationId || !token.trim() || connectMutation.isPending) return;

    setConnectError(null);
    connectMutation.mutate();
  }

  /** Every close path routes here, so a failed attempt never survives a reopen. */
  function handleClose() {
    if (connectMutation.isPending) return;

    connectMutation.reset();
    setToken('');
    setConnectError(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <DialogContent
        className="sm:h-auto sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Radix would focus the header's close button; the token field is the
          // point of this dialog.
          event.preventDefault();
          tokenRef.current?.focus();
        }}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-border border-b px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <DialogTitle>{t('setupTitle')}</DialogTitle>
            <p className="mt-1 text-muted-foreground text-sm">
              {isConnected ? t('replaceNote') : t('dialogDescription')}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={actionsT('closeDialog')}
            className="size-9"
            disabled={connectMutation.isPending}
            onClick={handleClose}
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-4 sm:px-6">
          {connectError ? (
            <StatusPanel tone="error">{t(`errors.${connectError.key}`)}</StatusPanel>
          ) : null}

          <ol className="grid gap-4">
            <li className="grid gap-2">
              <StepHeading failed={connectError?.step === 1} index={1} title={t('step1Title')} />
              <p className="pl-9 text-muted-foreground text-sm">{t('step1Body')}</p>
              <div className="flex flex-wrap items-center gap-2 pl-9">
                <Button asChild size="sm">
                  <a download href="/downloads/seo-potion.zip">
                    <Download aria-hidden="true" className="size-4" />
                    {t('downloadPlugin')}
                  </a>
                </Button>
                {/* Once the plugin ships on the WordPress.org directory, this can point at the
                  directory-search page and the self-hosted zip becomes a fallback. */}
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`${normalizedSiteUrl}/wp-admin/plugin-install.php?tab=upload`}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    <ExternalLink aria-hidden="true" className="size-4" />
                    {t('step1Action')}
                  </a>
                </Button>
              </div>
            </li>
            <SetupStep
              actionHref={`${normalizedSiteUrl}/wp-admin/admin.php?page=seo-potion-manage`}
              actionLabel={t('step2Action')}
              body={t('step2Body')}
              failed={connectError?.step === 2}
              index={2}
              title={t('step2Title')}
            />
            <li className="grid gap-2">
              <StepHeading failed={false} index={3} title={t('step3Title')} />
              <p className="pl-9 text-muted-foreground text-sm">{t('step3Body')}</p>
              <div className="grid gap-2 pl-9 sm:max-w-sm">
                <Label htmlFor="wordpress-token">{t('token')}</Label>
                <Input
                  autoComplete="off"
                  ref={tokenRef}
                  id="wordpress-token"
                  onChange={(event) => {
                    setToken(event.target.value);
                    setConnectError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;

                    event.preventDefault();
                    handleConnect();
                  }}
                  placeholder={t('tokenPlaceholder')}
                  spellCheck={false}
                  type="password"
                  value={token}
                />
              </div>
            </li>
          </ol>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-border border-t px-4 py-4 sm:px-6">
          <Button
            disabled={!organizationId || !token.trim() || connectMutation.isPending}
            onClick={handleConnect}
            type="button"
          >
            {connectMutation.isPending ? t('connecting') : t('connectAndTest')}
          </Button>
          <Button
            disabled={connectMutation.isPending}
            onClick={handleClose}
            type="button"
            variant="ghost"
          >
            {actionsT('close')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

function SetupStep({
  actionHref,
  actionLabel,
  body,
  failed,
  index,
  title,
}: {
  actionHref: string;
  actionLabel: string;
  body: string;
  failed: boolean;
  index: number;
  title: string;
}) {
  return (
    <li className="grid gap-2">
      <StepHeading failed={failed} index={index} title={title} />
      <p className="pl-9 text-muted-foreground text-sm">{body}</p>
      <Button asChild className="ml-9 w-fit" size="sm" variant="outline">
        <a href={actionHref} rel="noopener noreferrer" target="_blank">
          <ExternalLink aria-hidden="true" className="size-4" />
          {actionLabel}
        </a>
      </Button>
    </li>
  );
}

function StepHeading({ failed, index, title }: { failed: boolean; index: number; title: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className={cn(
          'flex size-6 items-center justify-center rounded-full text-background text-xs',
          failed ? 'bg-destructive' : 'bg-foreground',
        )}
      >
        {index}
      </span>
      <p className={cn('font-medium text-sm', failed ? 'text-error' : 'text-foreground')}>
        {title}
      </p>
    </div>
  );
}
