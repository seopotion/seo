'use client';

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
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';
import { articleStyles } from '../../onboarding/constants';

type ArticleSettingsForm = {
  autoPublish: boolean;
  articleStyle: string;
  internalLinksCount: string;
  tableOfContents: boolean;
};

type ArticleSettingsLoadState = 'error' | 'idle' | 'loading' | 'ready';
type ArticleSettingsSaveState = 'error' | 'idle' | 'saved';

type ArticleSettingsResponse = {
  article_preferences: {
    content_seo: {
      article_style: string;
      internal_links: boolean;
      llm_instructions: string;
    };
    engagement: {
      image_style: string;
    };
  };
};

const initialArticleSettings: ArticleSettingsForm = {
  articleStyle: articleStyles[1].value,
  autoPublish: false,
  internalLinksCount: '1',
  tableOfContents: true,
};

function mergeArticleSettings(
  data: ArticleSettingsResponse,
  currentSettings: ArticleSettingsForm,
): ArticleSettingsForm {
  return {
    ...currentSettings,
    articleStyle: data.article_preferences.content_seo.article_style,
    internalLinksCount: data.article_preferences.content_seo.internal_links ? '1' : '0',
  };
}

function buildArticleSettingsPatch(settings: ArticleSettingsForm) {
  return {
    content_seo: {
      article_style: settings.articleStyle,
      internal_links: Number.parseInt(settings.internalLinksCount, 10) > 0,
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
  const [settings, setSettings] = useState<ArticleSettingsForm>(initialArticleSettings);
  const [loadState, setLoadState] = useState<ArticleSettingsLoadState>('idle');
  const [saveState, setSaveState] = useState<ArticleSettingsSaveState>('idle');
  const [saving, setSaving] = useState(false);
  const editRevisionRef = useRef(0);

  const handleUnauthorized = useCallback(() => {
    clearToken();
    clearWorkspaceStatusCache();
    router.replace('/');
  }, [router]);

  useEffect(() => {
    if (organizationLoading) return;

    if (!organization) {
      setLoadState('idle');
      return;
    }

    let cancelled = false;

    setLoadState('loading');
    setSaveState('idle');

    void (async () => {
      try {
        const response = await api.api.v0.dashboard.settings.articles.$get({
          query: { org_id: organization.id },
        });

        if ((response.status as number) === 401) {
          handleUnauthorized();
          return;
        }

        if (!response.ok) {
          throw new Error('article_settings_load_failed');
        }

        const data = await response.json();

        if (!cancelled) {
          setSettings((currentSettings) => mergeArticleSettings(data, currentSettings));
          setLoadState('ready');
        }
      } catch {
        if (!cancelled) {
          setLoadState('error');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [handleUnauthorized, organization, organizationLoading]);

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

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!organization || saving) return;

    setSaving(true);
    setSaveState('idle');

    const saveRevision = editRevisionRef.current;

    try {
      const response = await api.api.v0.dashboard.settings.articles.$patch({
        json: {
          org_id: organization.id,
          ...buildArticleSettingsPatch(settings),
        },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        return;
      }

      if (!response.ok) {
        throw new Error('article_settings_save_failed');
      }

      const data = await response.json();
      if (editRevisionRef.current === saveRevision) {
        setSettings((currentSettings) => mergeArticleSettings(data, currentSettings));
        setSaveState('saved');
      }
    } catch {
      if (editRevisionRef.current === saveRevision) {
        setSaveState('error');
      }
    } finally {
      setSaving(false);
    }
  }

  if (
    organizationLoading ||
    organizationError === 'unauthorized' ||
    loadState === 'loading' ||
    (organization && loadState === 'idle')
  ) {
    return <StatusPanel>{t('status.loading')}</StatusPanel>;
  }

  if (organizationError === 'no_organization') {
    return <StatusPanel tone="error">{t('status.noOrganization')}</StatusPanel>;
  }

  if (organizationError === 'unavailable') {
    return <StatusPanel tone="error">{t('status.organizationError')}</StatusPanel>;
  }

  if (loadState === 'error') {
    return <StatusPanel tone="error">{t('status.loadError')}</StatusPanel>;
  }

  return (
    <form className="grid w-full gap-4" onSubmit={saveSettings}>
      <StatusPanel>{t('status.unsupportedFields')}</StatusPanel>
      {saveState === 'saved' && <StatusPanel tone="success">{t('status.saved')}</StatusPanel>}
      {saveState === 'error' && <StatusPanel tone="error">{t('status.saveError')}</StatusPanel>}

      <SwitchSetting
        checked={settings.autoPublish}
        description={t('fields.autoPublish.description')}
        id="auto-publish"
        label={t('fields.autoPublish.label')}
        onCheckedChange={(checked) => updateSetting('autoPublish', checked)}
      />

      <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-4">
        <div>
          <Label htmlFor="article-style">{t('fields.articleStyle.label')}</Label>
          <p className="mt-1 text-slate-500 text-sm">{t('fields.articleStyle.description')}</p>
        </div>
        <Select
          value={settings.articleStyle}
          onValueChange={(value) => updateSetting('articleStyle', value)}
        >
          <SelectTrigger id="article-style" className="max-w-md">
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

      <SwitchSetting
        checked={Number.parseInt(settings.internalLinksCount, 10) > 0}
        description={t('fields.internalLinks.description')}
        id="internal-links"
        label={t('fields.internalLinks.label')}
        onCheckedChange={(checked) => updateSetting('internalLinksCount', checked ? '1' : '0')}
      />

      <SwitchSetting
        checked={settings.tableOfContents}
        description={t('fields.tableOfContents.description')}
        id="table-of-contents"
        label={t('fields.tableOfContents.label')}
        onCheckedChange={(checked) => updateSetting('tableOfContents', checked)}
      />

      <div className="flex justify-end">
        <Button type="submit" disabled={saving || !organization}>
          {saving ? t('actions.saving') : t('actions.save')}
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
    <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-slate-500 text-sm">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
