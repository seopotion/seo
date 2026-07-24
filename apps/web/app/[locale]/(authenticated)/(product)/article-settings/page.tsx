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
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';
import { articleStyles, internalLinkCounts } from '../../onboarding/constants';

type ArticleSettingsForm = {
  autoPublish: boolean;
  articleStyle: string;
  internalLinksCount: string;
  tableOfContents: boolean;
  youtubeVideos: boolean;
};

type ArticleSettingsSaveState = 'error' | 'idle' | 'saved';

type ArticleSettingsResponse = {
  article_preferences: {
    content_seo: {
      article_style: string;
      internal_links_count: number;
      table_of_contents: boolean;
      llm_instructions: string;
    };
    engagement: {
      image_style: string;
      youtube_videos: boolean;
    };
    publishing: {
      auto_publish: boolean;
    };
  };
};

type ArticleSettingsMutationVariables = {
  organizationId: string;
  saveRevision: number;
  settings: ArticleSettingsForm;
};

const initialArticleSettings: ArticleSettingsForm = {
  articleStyle: articleStyles[1].value,
  autoPublish: false,
  internalLinksCount: '1',
  tableOfContents: true,
  youtubeVideos: true,
};

function mergeArticleSettings(
  data: ArticleSettingsResponse,
  currentSettings: ArticleSettingsForm,
): ArticleSettingsForm {
  return {
    ...currentSettings,
    articleStyle: data.article_preferences.content_seo.article_style,
    internalLinksCount: String(data.article_preferences.content_seo.internal_links_count),
    tableOfContents: data.article_preferences.content_seo.table_of_contents,
    youtubeVideos: data.article_preferences.engagement.youtube_videos,
    autoPublish: data.article_preferences.publishing.auto_publish,
  };
}

function buildArticleSettingsPatch(settings: ArticleSettingsForm) {
  return {
    content_seo: {
      article_style: settings.articleStyle,
      internal_links_count: Number.parseInt(settings.internalLinksCount, 10),
      table_of_contents: settings.tableOfContents,
    },
    engagement: {
      youtube_videos: settings.youtubeVideos,
    },
    publishing: {
      auto_publish: settings.autoPublish,
    },
  };
}

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
  const editRevisionRef = useRef(0);

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

      if (editRevisionRef.current === saveRevision) {
        setSettings((currentSettings) => mergeArticleSettings(data, currentSettings));
        setSaveState('saved');
      }
    },
    onError: (error, { saveRevision }) => {
      if (error instanceof Error && error.message === 'unauthorized') return;

      if (editRevisionRef.current === saveRevision) {
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
        <SwitchSetting
          checked={settings.autoPublish}
          description={t('fields.autoPublish.description')}
          id="auto-publish"
          label={t('fields.autoPublish.label')}
          onCheckedChange={(checked) => updateSetting('autoPublish', checked)}
        />

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
        <p className="mt-1 text-slate-500 text-sm">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
