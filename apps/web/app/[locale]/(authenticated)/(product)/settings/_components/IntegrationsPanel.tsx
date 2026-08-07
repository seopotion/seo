'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, GitBranch } from 'lucide-react';
import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Input, Label } from '@/components/ui';
import { api } from '@/lib/api';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { GITHUB_RETURN_LOCALE_KEY, useConnectedIntegrations } from '@/lib/integrations';
import type { ProductOrganization } from '@/lib/organizations';
import { cn } from '@/lib/utils';

type WordPressErrorKey = 'connectFailed' | 'invalidToken' | 'pluginNotConfigured' | 'requestFailed';
type FailedStep = 1 | 2 | null;
type ConnectError = { key: WordPressErrorKey; step: FailedStep };
type InstallErrorKey = 'installFailed' | 'notConfigured';

const REQUEST_FAILED_ERROR: ConnectError = { key: 'requestFailed', step: 1 };

/**
 * `integration.last_error.code` -> a message key. These are the GithubError
 * codes the publish route persists (its 422 bucket); anything else falls back
 * to `unknown`, so a new code added server-side degrades to a generic line
 * rather than rendering a raw identifier.
 */
type PublishErrorKey =
  | 'publishErrors.installationGone'
  | 'publishErrors.suspended'
  | 'publishErrors.missingPermission'
  | 'publishErrors.repoNotFound'
  | 'publishErrors.commitRejected'
  | 'publishErrors.unknown';

const PUBLISH_ERROR_KEYS: Record<string, PublishErrorKey> = {
  installation_not_found: 'publishErrors.installationGone',
  installation_suspended: 'publishErrors.suspended',
  missing_write_permission: 'publishErrors.missingPermission',
  repo_not_found: 'publishErrors.repoNotFound',
  commit_rejected: 'publishErrors.commitRejected',
};

/**
 * Of those, the ones the user fixes by reinstalling rather than retrying.
 * `commit_rejected` is deliberately absent: the connection is healthy, the
 * branch is protected — reinstalling would change nothing.
 */
const RECONNECT_CODES = new Set([
  'installation_not_found',
  'installation_suspended',
  'missing_write_permission',
  'repo_not_found',
]);

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
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [token, setToken] = useState('');
  const [connectError, setConnectError] = useState<ConnectError | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installErrorKey, setInstallErrorKey] = useState<InstallErrorKey | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
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
  const showSetup = !isConnected || replacing;
  const siteUrl = (organization?.website_url ?? '').replace(/\/+$/, '');

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

  const connectMutation = useMutation({
    mutationFn: async () => {
      if (!organization) throw new Error('organization_required');

      const response = await api.api.v0.dashboard.integrations.wordpress.$post({
        json: { org_id: organization.id, token: token.trim() },
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

      if (organization) {
        const connectedIntegrationsKey = dashboardQueryKeys.connectedIntegrations(organization.id);
        queryClient.setQueryData(connectedIntegrationsKey, {
          integrations: [
            {
              id: 'wordpress',
              provider: 'wordpress' as const,
              connected_at: new Date().toISOString(),
            },
          ],
        });
        void queryClient.invalidateQueries({ queryKey: connectedIntegrationsKey });
      }

      setToken('');
      setConnectError(null);
      setReplacing(false);
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

  const disconnectSiteMutation = useMutation({
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
      setJustConnectedSite(false);
      if (!organization) return;
      void queryClient.invalidateQueries({
        queryKey: dashboardQueryKeys.connectedIntegrations(organization.id),
      });
    },
  });

  const disconnectSiteFailed =
    disconnectSiteMutation.isError &&
    (disconnectSiteMutation.error as Error | null)?.message !== 'unauthorized';

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

  function handleConnect() {
    if (!organization || !token.trim() || connectMutation.isPending) return;

    setConnectError(null);
    connectMutation.mutate();
  }

  function startReplace() {
    connectMutation.reset();
    setReplacing(true);
  }

  function cancelReplace() {
    connectMutation.reset();
    setReplacing(false);
    setToken('');
    setConnectError(null);
  }

  return (
    <div className="grid gap-4">
      <div>
        <p className="font-medium text-sm leading-none">{t('gallery')}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                    <div className="flex flex-wrap gap-2">
                      <Button asChild variant="outline" size="sm" className="w-fit">
                        <a download href="/downloads/seo-potion.zip">
                          <Download aria-hidden="true" className="size-4" />
                          {t('downloadPlugin')}
                        </a>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={startReplace}
                      >
                        {t('replaceToken')}
                      </Button>
                    </div>
                  </>
                ) : null}
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
                    {staticSiteError ? (
                      <p className="text-amber-700 text-xs">
                        {staticSiteT(
                          PUBLISH_ERROR_KEYS[staticSiteError.code] ?? 'publishErrors.unknown',
                        )}
                      </p>
                    ) : null}
                    {disconnectSiteFailed ? (
                      <p className="text-red-600 text-xs">{staticSiteT('disconnectError')}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Same hand-off either way — only the label and the
                          emphasis change, because a dead installation is not
                          something the user should have to guess is fixable. */}
                      <Button
                        type="button"
                        variant={needsReconnect ? 'default' : 'outline'}
                        size="sm"
                        className="w-fit"
                        disabled={!organization || installing}
                        onClick={startInstall}
                      >
                        {installing
                          ? staticSiteT('connecting')
                          : needsReconnect
                            ? staticSiteT('reconnect')
                            : staticSiteT('changeRepository')}
                      </Button>
                      {confirmingDisconnect ? (
                        <>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            disabled={disconnectSiteMutation.isPending}
                            onClick={() => disconnectSiteMutation.mutate()}
                          >
                            {staticSiteT('disconnectConfirmYes')}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disconnectSiteMutation.isPending}
                            onClick={() => setConfirmingDisconnect(false)}
                          >
                            {staticSiteT('disconnectCancel')}
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
                          {staticSiteT('disconnect')}
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-slate-500 text-xs">{staticSiteT('description')}</p>
                    <Button
                      type="button"
                      size="sm"
                      className="w-fit"
                      disabled={!organization || installing}
                      onClick={startInstall}
                    >
                      {installing ? staticSiteT('connecting') : staticSiteT('connect')}
                    </Button>
                  </>
                )}
                {installErrorKey ? (
                  <p className="text-red-600 text-xs">{staticSiteT(`errors.${installErrorKey}`)}</p>
                ) : null}
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

      {connectMutation.data?.success ? (
        <StatusPanel tone="success">{t('connectedSuccess')}</StatusPanel>
      ) : null}

      {showSetup ? (
        <div className="grid gap-4 rounded-md border border-slate-200 bg-white p-4">
          <div>
            <p className="font-medium text-sm leading-none">{t('setupTitle')}</p>
            {replacing ? <p className="mt-1 text-slate-500 text-sm">{t('replaceNote')}</p> : null}
          </div>

          {connectError ? (
            <StatusPanel tone="error">{t(`errors.${connectError.key}`)}</StatusPanel>
          ) : null}

          <ol className="grid gap-4">
            <li className="grid gap-2">
              <StepHeading failed={connectError?.step === 1} index={1} title={t('step1Title')} />
              <p className="pl-9 text-slate-500 text-sm">{t('step1Body')}</p>
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
                    href={`${siteUrl}/wp-admin/plugin-install.php?tab=upload`}
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
              actionHref={`${siteUrl}/wp-admin/admin.php?page=seo-potion-manage`}
              actionLabel={t('step2Action')}
              body={t('step2Body')}
              failed={connectError?.step === 2}
              index={2}
              title={t('step2Title')}
            />
            <li className="grid gap-2">
              <StepHeading failed={false} index={3} title={t('step3Title')} />
              <p className="pl-9 text-slate-500 text-sm">{t('step3Body')}</p>
              <div className="grid gap-2 pl-9 sm:max-w-sm">
                <Label htmlFor="wordpress-token">{t('token')}</Label>
                <Input
                  autoComplete="off"
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
                <div className="flex items-center gap-2">
                  <Button
                    disabled={!organization || !token.trim() || connectMutation.isPending}
                    onClick={handleConnect}
                    type="button"
                  >
                    {connectMutation.isPending ? t('connecting') : t('connectAndTest')}
                  </Button>
                  {replacing ? (
                    <Button onClick={cancelReplace} type="button" variant="ghost">
                      {t('cancel')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          </ol>
        </div>
      ) : null}
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
      <p className="pl-9 text-slate-500 text-sm">{body}</p>
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
          'flex size-6 items-center justify-center rounded-full text-white text-xs',
          failed ? 'bg-red-600' : 'bg-slate-900',
        )}
      >
        {index}
      </span>
      <p className={cn('font-medium text-sm', failed ? 'text-red-700' : 'text-slate-950')}>
        {title}
      </p>
    </div>
  );
}

function StatusPanel({ children, tone }: { children: ReactNode; tone: 'error' | 'success' }) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      )}
    >
      {children}
    </div>
  );
}
