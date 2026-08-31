'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { getAutoPublishReadiness, isAutoPublishChangeAllowed } from '@/lib/auto-publishing';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useConnectedIntegrations } from '@/lib/integrations';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';
import { articleStyles, internalLinkCounts } from '../../onboarding/constants';
import {
  type ArticleSettingsForm,
  type ArticleSettingsResponse,
  buildArticleSettingsPatch,
  initialArticleSettings,
  mergeArticleSettings,
} from './article-settings';

type ArticleSettingsSaveState = 'error' | 'idle' | 'saved';

type ArticleSettingsMutationVariables = {
  organizationId: string;
  saveRevision: number;
  settings: ArticleSettingsForm;
};

export default function ArticleSettingsPage() {
  const t = useTranslations('ArticleSettingsPage');
  const optionsT = useTranslations('Onboarding.options');
  const router = useRouter();
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<ArticleSettingsForm>(initialArticleSettings);
  const [initializedOrganizationId, setInitializedOrganizationId] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [saveState, setSaveState] = useState<ArticleSettingsSaveState>('idle');
  const activeOrganizationIdRef = useRef<string | null>(null);
  const editRevisionRef = useRef(0);
  activeOrganizationIdRef.current = organization?.id ?? null;

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const settingsQuery = useQuery({
    queryKey: dashboardQueryKeys.articleSettings(organization?.id ?? ''),
    queryFn: async () => {
      if (!organization) {
        throw new Error('organization_required');
      }

      const response = await api.api.v0.dashboard.settings.articles.$get({
        query: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('article_settings_load_failed');
      }

      return response.json();
    },
    enabled: !redirecting && !organizationLoading && Boolean(organization),
    refetchOnWindowFocus: false,
    staleTime: 60 * 60 * 1000,
  });

  const connectedIntegrationsQuery = useConnectedIntegrations(organization?.id ?? null, {
    enabled: !redirecting && !organizationLoading,
    onUnauthorized: handleUnauthorized,
  });
  const autoPublishReadiness = getAutoPublishReadiness({
    destinationState: connectedIntegrationsQuery.isError
      ? 'error'
      : connectedIntegrationsQuery.data
        ? 'ready'
        : 'loading',
    destinations: connectedIntegrationsQuery.data?.integrations ?? [],
    hasEntitlement: organization?.capabilities.keyword_scheduling ?? false,
  });
  const autoPublishNoticeIds = [
    ...autoPublishReadiness.blockers.map((blocker) => `auto-publish-${blocker}`),
    ...(autoPublishReadiness.allDestinationsHaveErrors ? ['auto-publish-destination-errors'] : []),
  ];

  useEffect(() => {
    if (!organization || !settingsQuery.data) return;

    const isNewOrganization = initializedOrganizationId !== organization.id;

    if (!isNewOrganization && editRevisionRef.current !== 0) return;

    if (isNewOrganization) {
      editRevisionRef.current = 0;
      setSaveState('idle');
    }

    setSettings((currentSettings) =>
      mergeArticleSettings(
        settingsQuery.data,
        isNewOrganization ? initialArticleSettings : currentSettings,
      ),
    );
    setInitializedOrganizationId(organization.id);
  }, [initializedOrganizationId, organization, settingsQuery.data]);

  const saveSettingsMutation = useMutation({
    mutationFn: async ({
      organizationId,
      settings: settingsToSave,
    }: ArticleSettingsMutationVariables) => {
      const response = await api.api.v0.dashboard.settings.articles.$patch({
        json: {
          org_id: organizationId,
          ...buildArticleSettingsPatch(settingsToSave),
        },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('article_settings_save_failed');
      }

      return response.json();
    },
    onSuccess: (data, { organizationId, saveRevision }) => {
      queryClient.setQueryData<ArticleSettingsResponse>(
        dashboardQueryKeys.articleSettings(organizationId),
        data,
      );

      if (
        activeOrganizationIdRef.current === organizationId &&
        editRevisionRef.current === saveRevision
      ) {
        setSettings((currentSettings) => mergeArticleSettings(data, currentSettings));
        setSaveState('saved');
      }
    },
    onError: (error, { organizationId, saveRevision }) => {
      if (error instanceof Error && error.message === 'unauthorized') return;

      if (
        activeOrganizationIdRef.current === organizationId &&
        editRevisionRef.current === saveRevision
      ) {
        setSaveState('error');
      }
    },
  });

  function markEdited() {
    editRevisionRef.current += 1;
    setSaveState('idle');
  }

  function updateSetting<Field extends keyof ArticleSettingsForm>(
    field: Field,
    value: ArticleSettingsForm[Field],
  ) {
    setSettings((currentSettings) => ({
      ...currentSettings,
      [field]: value,
    }));
    markEdited();
  }

  function updateAutoPublish(checked: boolean) {
    if (!isAutoPublishChangeAllowed(settings.autoPublish, checked, autoPublishReadiness)) return;
    updateSetting('autoPublish', checked);
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization || saveSettingsMutation.isPending) return;

    setSaveState('idle');

    saveSettingsMutation.mutate({
      organizationId: organization.id,
      saveRevision: editRevisionRef.current,
      settings,
    });
  }

  if (
    redirecting ||
    organizationLoading ||
    organizationError === 'unauthorized' ||
    (organization && settingsQuery.isPending) ||
    (organization && Boolean(settingsQuery.data) && initializedOrganizationId !== organization.id)
  ) {
    return <StatusPanel>{t('status.loading')}</StatusPanel>;
  }

  if (organizationError === 'no_organization') {
    return <StatusPanel tone="error">{t('status.noOrganization')}</StatusPanel>;
  }

  if (organizationError === 'unavailable') {
    return <StatusPanel tone="error">{t('status.organizationError')}</StatusPanel>;
  }

  if (settingsQuery.isError) {
    return <StatusPanel tone="error">{t('status.loadError')}</StatusPanel>;
  }

  return (
    <form className="grid w-full gap-4" onSubmit={saveSettings}>
      {saveState === 'saved' && <StatusPanel tone="success">{t('status.saved')}</StatusPanel>}
      {saveState === 'error' && <StatusPanel tone="error">{t('status.saveError')}</StatusPanel>}

      <div className="rounded-md border border-slate-200 bg-white">
        <div className="grid gap-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Label htmlFor="auto-publish">{t('fields.autoPublish.label')}</Label>
              <div id="auto-publish-description" className="mt-1 text-slate-500 text-sm">
                <p>{t('fields.autoPublish.description')}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  <li>{t('fields.autoPublish.details.futureArticles')}</li>
                  <li>{t('fields.autoPublish.details.destinations')}</li>
                  <li>{t('fields.autoPublish.details.wordpress')}</li>
                  <li>{t('fields.autoPublish.details.failedAttempts')}</li>
                </ul>
              </div>
            </div>
            <Switch
              id="auto-publish"
              checked={settings.autoPublish}
              aria-describedby={['auto-publish-description', ...autoPublishNoticeIds].join(' ')}
              aria-disabled={!settings.autoPublish && !autoPublishReadiness.canActivate}
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              onCheckedChange={updateAutoPublish}
            />
          </div>

          {autoPublishReadiness.blockers.includes('entitlement_required') ? (
            <AutoPublishNotice id="auto-publish-entitlement_required">
              <span>
                {t(
                  settings.autoPublish
                    ? 'fields.autoPublish.requirements.entitlementEnabled'
                    : 'fields.autoPublish.requirements.entitlement',
                )}
              </span>{' '}
              <SettingsLink href="/billing">{t('fields.autoPublish.links.billing')}</SettingsLink>
            </AutoPublishNotice>
          ) : null}

          {autoPublishReadiness.blockers.includes('destination_check_pending') ? (
            <AutoPublishNotice id="auto-publish-destination_check_pending">
              {t(
                settings.autoPublish
                  ? 'fields.autoPublish.requirements.checkingEnabled'
                  : 'fields.autoPublish.requirements.checking',
              )}
            </AutoPublishNotice>
          ) : null}

          {autoPublishReadiness.blockers.includes('destination_check_failed') ? (
            <AutoPublishNotice id="auto-publish-destination_check_failed">
              <span>
                {t(
                  settings.autoPublish
                    ? 'fields.autoPublish.requirements.checkFailedEnabled'
                    : 'fields.autoPublish.requirements.checkFailed',
                )}
              </span>{' '}
              <SettingsLink href="/settings?tab=integrations">
                {t('fields.autoPublish.links.integrations')}
              </SettingsLink>
            </AutoPublishNotice>
          ) : null}

          {autoPublishReadiness.blockers.includes('no_destination') ? (
            <AutoPublishNotice id="auto-publish-no_destination">
              <span>
                {t(
                  settings.autoPublish
                    ? 'fields.autoPublish.requirements.noDestinationEnabled'
                    : 'fields.autoPublish.requirements.noDestination',
                )}
              </span>{' '}
              <SettingsLink href="/settings?tab=integrations">
                {t('fields.autoPublish.links.integrations')}
              </SettingsLink>
            </AutoPublishNotice>
          ) : null}

          {autoPublishReadiness.allDestinationsHaveErrors ? (
            <AutoPublishNotice id="auto-publish-destination-errors">
              <span>{t('fields.autoPublish.requirements.allDestinationsHaveErrors')}</span>{' '}
              <SettingsLink href="/settings?tab=integrations">
                {t('fields.autoPublish.links.integrations')}
              </SettingsLink>
            </AutoPublishNotice>
          ) : null}
        </div>

        <div className="grid gap-2 p-4">
          <div>
            <Label htmlFor="article-style">{t('fields.articleStyle.label')}</Label>
            <p className="mt-1 text-slate-500 text-sm">{t('fields.articleStyle.description')}</p>
          </div>
          <Select
            value={settings.articleStyle}
            onValueChange={(value) => updateSetting('articleStyle', value)}
          >
            <SelectTrigger id="article-style" className="max-w-95">
              <SelectValue placeholder={t('fields.articleStyle.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {articleStyles.map((style) => (
                <SelectItem key={style.value} value={style.value}>
                  {optionsT(`articleStyles.${style.labelKey}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-2 p-4">
          <div>
            <Label htmlFor="internal-links">{t('fields.internalLinks.label')}</Label>
            <p className="mt-1 text-slate-500 text-sm">{t('fields.internalLinks.description')}</p>
          </div>
          <Select
            value={settings.internalLinksCount}
            onValueChange={(value) => updateSetting('internalLinksCount', value)}
          >
            <SelectTrigger id="internal-links" className="max-w-95">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {internalLinkCounts.map((count) => (
                <SelectItem key={count} value={count}>
                  {count}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <SwitchSetting
          checked={settings.tableOfContents}
          description={t('fields.tableOfContents.description')}
          id="table-of-contents"
          label={t('fields.tableOfContents.label')}
          onCheckedChange={(checked) => updateSetting('tableOfContents', checked)}
        />

        <SwitchSetting
          checked={settings.youtubeVideos}
          description={t('fields.youtubeVideos.description')}
          id="youtube-videos"
          label={t('fields.youtubeVideos.label')}
          onCheckedChange={(checked) => updateSetting('youtubeVideos', checked)}
        />

        <SwitchSetting
          checked={settings.includeCta}
          description={t('fields.includeCta.description')}
          id="include-cta"
          label={t('fields.includeCta.label')}
          onCheckedChange={(checked) => updateSetting('includeCta', checked)}
        />
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={saveSettingsMutation.isPending || !organization}>
          {saveSettingsMutation.isPending ? t('actions.saving') : t('actions.save')}
        </Button>
      </div>
    </form>
  );
}

function StatusPanel({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'error' | 'neutral' | 'success';
}) {
  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        tone === 'neutral' && 'border-slate-200 bg-white text-slate-600',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      )}
    >
      {children}
    </div>
  );
}

function AutoPublishNotice({ children, id }: { children: ReactNode; id: string }) {
  return (
    <p
      id={id}
      role="status"
      className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900 text-sm"
    >
      {children}
    </p>
  );
}

function SettingsLink({ children, href }: { children: ReactNode; href: string }) {
  return (
    <Link className="font-medium text-amber-950 underline underline-offset-2" href={href}>
      {children}
    </Link>
  );
}

function SwitchSetting({
  checked,
  description,
  id,
  label,
  onCheckedChange,
}: {
  checked: boolean;
  description: ReactNode;
  id: string;
  label: ReactNode;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-description`} className="mt-1 text-slate-500 text-sm">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        aria-describedby={`${id}-description`}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
