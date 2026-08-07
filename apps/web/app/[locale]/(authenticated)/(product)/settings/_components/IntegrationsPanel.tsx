'use client';

import { useQueryClient } from '@tanstack/react-query';
import { GitBranch } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { PUBLISH_ERROR_KEYS, RECONNECT_CODES, useConnectedIntegrations } from '@/lib/integrations';
import type { ProductOrganization } from '@/lib/organizations';
import { cn } from '@/lib/utils';
import { StaticSiteDialog } from './StaticSiteDialog';
import { StatusPanel } from './StatusPanel';
import { WordPressDialog } from './WordPressDialog';

type DialogProvider = 'wordpress' | 'static-site';

export function IntegrationsPanel({
  onUnauthorized,
  organization,
}: {
  onUnauthorized: () => void;
  organization: ProductOrganization | null;
}) {
  // `SettingsPage.wordpress` is the integrations tab's namespace, despite the
  // name it was given when WordPress was the only thing in it; the static-site
  // strings are their own namespace rather than nested under a wrong one.
  const t = useTranslations('SettingsPage.wordpress');
  const staticSiteT = useTranslations('SettingsPage.staticSite');
  const actionsT = useTranslations('SettingsPage.actions');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [openDialog, setOpenDialog] = useState<DialogProvider | null>(null);
  const [justConnectedWordPress, setJustConnectedWordPress] = useState(false);
  const [justConnectedSite, setJustConnectedSite] = useState(false);

  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }),
    [locale],
  );

  const connectedQuery = useConnectedIntegrations(organization, { onUnauthorized });
  const wordpressIntegration = connectedQuery.data?.integrations.find(
    (integration) => integration.provider === 'wordpress',
  );
  const staticSiteIntegration = connectedQuery.data?.integrations.find(
    (integration) => integration.provider === 'static-site',
  );
  const staticSiteError = staticSiteIntegration?.last_error ?? null;
  const needsReconnect = Boolean(staticSiteError && RECONNECT_CODES.has(staticSiteError.code));
  const isConnected = Boolean(wordpressIntegration);

  // One-time banner after the install callback redirects back; strip the param
  // so a refresh or a back-navigation doesn't replay it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') !== 'static-site') return;
    setJustConnectedSite(true);
    if (organization) {
      void queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.connectedIntegrations(organization.id),
      });
    }
    params.delete('connected');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [organization, queryClient]);

  return (
    <div className="grid gap-4">
      <div>
        <p className="font-medium text-sm leading-none">{t('gallery')}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <IntegrationCard
            logo={
              <Image
                alt=""
                aria-hidden
                height={20}
                src="/integrations/wordpress-org.svg"
                width={20}
              />
            }
            name={t('providers.wordpress')}
          >
            {connectedQuery.isLoading ? (
              <p className="text-slate-500 text-xs">{t('loading')}</p>
            ) : connectedQuery.isError ? (
              <p className="text-red-600 text-xs">{t('loadError')}</p>
            ) : (
              <>
                <Badge
                  variant="secondary"
                  className={cn(
                    'w-fit border-transparent',
                    isConnected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700',
                  )}
                >
                  {t(isConnected ? 'badges.connected' : 'badges.notConnected')}
                </Badge>
                {wordpressIntegration ? (
                  <>
                    <p className="text-slate-500 text-xs">
                      {t('connectedOn', {
                        date: dateFormatter.format(new Date(wordpressIntegration.connected_at)),
                      })}
                    </p>
                    {organization?.website_url ? (
                      <p className="truncate text-slate-500 text-xs">{organization.website_url}</p>
                    ) : null}
                  </>
                ) : null}
                <Button
                  type="button"
                  variant={isConnected ? 'outline' : 'default'}
                  size="sm"
                  className="w-fit justify-self-end"
                  onClick={() => setOpenDialog('wordpress')}
                >
                  {actionsT(isConnected ? 'manage' : 'connect')}
                </Button>
              </>
            )}
          </IntegrationCard>

          <IntegrationCard
            logo={<GitBranch aria-hidden className="size-5 text-slate-700" />}
            name={staticSiteT('provider')}
          >
            {connectedQuery.isLoading ? (
              <p className="text-slate-500 text-xs">{t('loading')}</p>
            ) : connectedQuery.isError ? (
              <p className="text-red-600 text-xs">{t('loadError')}</p>
            ) : (
              <>
                <Badge
                  variant="secondary"
                  className={cn(
                    'w-fit border-transparent',
                    !staticSiteIntegration
                      ? 'bg-slate-200 text-slate-700'
                      : staticSiteError
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-700',
                  )}
                >
                  {staticSiteIntegration
                    ? staticSiteError
                      ? staticSiteT('needsAttention')
                      : t('badges.connected')
                    : t('badges.notConnected')}
                </Badge>
                {staticSiteIntegration ? (
                  <>
                    {/* `owner/repo@branch`, built server-side. */}
                    <p className="truncate font-medium text-slate-950 text-xs">
                      {staticSiteIntegration.target}
                    </p>
                    <p className="text-slate-500 text-xs">
                      {t('connectedOn', {
                        date: dateFormatter.format(new Date(staticSiteIntegration.connected_at)),
                      })}
                    </p>
                    {/* A dead connection has to be visible without opening anything. */}
                    {staticSiteError ? (
                      <p className="text-amber-700 text-xs">
                        {staticSiteT(
                          PUBLISH_ERROR_KEYS[staticSiteError.code] ?? 'publishErrors.unknown',
                        )}
                      </p>
                    ) : null}
                  </>
                ) : null}
                <Button
                  type="button"
                  variant={!staticSiteIntegration || needsReconnect ? 'default' : 'outline'}
                  size="sm"
                  className="w-fit justify-self-end"
                  onClick={() => setOpenDialog('static-site')}
                >
                  {actionsT(staticSiteIntegration ? 'manage' : 'connect')}
                </Button>
              </>
            )}
          </IntegrationCard>

          <IntegrationCard
            logo={
              <Image alt="" aria-hidden height={20} src="/integrations/wordpress.svg" width={20} />
            }
            name={t('providers.wordpressCom')}
          >
            <Badge variant="secondary" className="w-fit">
              {t('comingSoon')}
            </Badge>
          </IntegrationCard>

          <IntegrationCard
            logo={
              <Image alt="" aria-hidden height={20} src="/integrations/framer.svg" width={20} />
            }
            name={t('providers.framer')}
          >
            <Badge variant="secondary" className="w-fit">
              {t('comingSoon')}
            </Badge>
          </IntegrationCard>
        </div>
      </div>

      {justConnectedSite ? (
        <StatusPanel tone="success">{staticSiteT('connectedSuccess')}</StatusPanel>
      ) : null}

      {justConnectedWordPress ? (
        <StatusPanel tone="success">{t('connectedSuccess')}</StatusPanel>
      ) : null}

      <WordPressDialog
        isConnected={isConnected}
        onClose={() => setOpenDialog(null)}
        onConnected={() => {
          setJustConnectedWordPress(true);
          setOpenDialog(null);
        }}
        onUnauthorized={onUnauthorized}
        open={openDialog === 'wordpress'}
        organization={organization}
      />
      <StaticSiteDialog
        dateFormatter={dateFormatter}
        integration={staticSiteIntegration ?? null}
        needsReconnect={needsReconnect}
        onClose={() => setOpenDialog(null)}
        onDisconnected={() => {
          setJustConnectedSite(false);
          setOpenDialog(null);
        }}
        onUnauthorized={onUnauthorized}
        open={openDialog === 'static-site'}
        organization={organization}
      />
    </div>
  );
}

/** `logo` is a node, not a src: the static site has no brand mark of its own —
 *  the git host is a field on it, not the provider. */
function IntegrationCard({
  children,
  logo,
  name,
}: {
  children: ReactNode;
  logo: ReactNode;
  name: string;
}) {
  return (
    <div className="grid content-start gap-2 rounded-md border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center">{logo}</span>
        <p className="font-semibold text-slate-950 text-sm">{name}</p>
      </div>
      {children}
    </div>
  );
}
