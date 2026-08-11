'use client';

import type { SetupPresets } from '@shared/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { clearToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useActiveOrganization } from '@/lib/organizations';
import { clearWorkspaceStatusCache } from '@/lib/session';
import { cn } from '@/lib/utils';
import {
  competitorErrorKey,
  MAX_COMPETITORS,
  normalizeCompetitorList,
  prepareCompetitor,
} from '../../onboarding/competitors';
import { TextEntryList } from '../../onboarding/components/TextEntryList';
import { countries, languages, MAX_TARGET_AUDIENCES } from '../../onboarding/constants';
import type { TextEntry } from '../../onboarding/types';
import { createEntryId, stringsToTextEntries, textEntriesToStrings } from '../../onboarding/utils';
import { BillingPanel } from './_components/BillingPanel';
import { GoogleSearchConsolePanel } from './_components/GoogleSearchConsolePanel';
import { IntegrationsPanel } from './_components/IntegrationsPanel';

const settingsTabs = [
  'business',
  'audienceCompetitors',
  'integrations',
  'googleSearchConsole',
  'billing',
] as const;

type SettingsTab = (typeof settingsTabs)[number];

/**
 * The tabs whose fields `saveSettings` actually posts. The others connect and
 * disconnect through their own panels, so a Save button on them submits an
 * unchanged payload and reads as a control the user forgot to press.
 */
const SAVEABLE_TABS = new Set<SettingsTab>(['business', 'audienceCompetitors']);

type SettingsForm = {
  businessDescription: string;
  businessName: string;
  competitors: TextEntry[];
  country: string;
  language: string;
  targetAudience: TextEntry[];
};

type SettingsSaveState = 'error' | 'idle' | 'saved';

type GeneralSettingsResponse = Pick<SetupPresets, 'audience' | 'business'>;

type GeneralSettingsMutationVariables = {
  organizationId: string;
  saveRevision: number;
  settings: SettingsForm;
};

const initialSettings: SettingsForm = {
  businessDescription: '',
  businessName: '',
  competitors: [],
  country: countries[0].value,
  language: languages[0].value,
  targetAudience: [],
};

function mergeGeneralSettings(
  data: GeneralSettingsResponse,
  currentSettings: SettingsForm,
): SettingsForm {
  return {
    ...currentSettings,
    businessDescription: data.business.description,
    businessName: data.business.name,
    competitors: stringsToTextEntries(
      normalizeCompetitorList(data.audience.competitors),
      'competitor',
    ),
    country: data.business.country,
    language: data.business.language,
    targetAudience: stringsToTextEntries(data.audience.target, 'audience'),
  };
}

function buildGeneralSettingsPatch(settings: SettingsForm) {
  return {
    audience: {
      competitors: settings.competitors.map((entry) => entry.value.trim()).filter(Boolean),
      target: textEntriesToStrings(settings.targetAudience),
    },
    business: {
      country: settings.country,
      description: settings.businessDescription.trim(),
      language: settings.language,
      name: settings.businessName.trim(),
    },
  };
}

export default function SettingsPage() {
  const t = useTranslations('SettingsPage');
  const businessT = useTranslations('Onboarding.business');
  const audienceT = useTranslations('Onboarding.audience');
  const optionsT = useTranslations('Onboarding.options');
  const validationT = useTranslations('Onboarding.validation');
  const router = useRouter();
  const {
    error: organizationError,
    loading: organizationLoading,
    organization,
  } = useActiveOrganization();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<SettingsTab>('business');
  const [settings, setSettings] = useState<SettingsForm>(initialSettings);
  const [audienceDraft, setAudienceDraft] = useState('');
  const [audienceError, setAudienceError] = useState('');
  const [competitorDraft, setCompetitorDraft] = useState('');
  const [competitorError, setCompetitorError] = useState('');
  const [initializedOrganizationId, setInitializedOrganizationId] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [saveState, setSaveState] = useState<SettingsSaveState>('idle');
  const editRevisionRef = useRef(0);

  const handleUnauthorized = useCallback(() => {
    setRedirecting(true);
    clearToken();
    clearWorkspaceStatusCache();
    queryClient.clear();
    router.replace('/');
  }, [queryClient, router]);

  const settingsQuery = useQuery({
    queryKey: dashboardQueryKeys.generalSettings(organization?.id ?? ''),
    queryFn: async () => {
      if (!organization) {
        throw new Error('organization_required');
      }

      const response = await api.api.v0.dashboard.settings.general.$get({
        query: { org_id: organization.id },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('settings_load_failed');
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
      mergeGeneralSettings(
        settingsQuery.data,
        isNewOrganization ? initialSettings : currentSettings,
      ),
    );
    setInitializedOrganizationId(organization.id);
  }, [initializedOrganizationId, organization, settingsQuery.data]);

  const saveSettingsMutation = useMutation({
    mutationFn: async ({
      organizationId,
      settings: settingsToSave,
    }: GeneralSettingsMutationVariables) => {
      const response = await api.api.v0.dashboard.settings.general.$patch({
        json: {
          org_id: organizationId,
          ...buildGeneralSettingsPatch(settingsToSave),
        },
      });

      if ((response.status as number) === 401) {
        handleUnauthorized();
        throw new Error('unauthorized');
      }

      if (!response.ok) {
        throw new Error('settings_save_failed');
      }

      return response.json();
    },
    onSuccess: (data, { organizationId, saveRevision }) => {
      queryClient.setQueryData<GeneralSettingsResponse>(
        dashboardQueryKeys.generalSettings(organizationId),
        data,
      );

      // The patch writes organization.name, which the topbar renders off the
      // cached org.
      void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys.organizations() });

      if (editRevisionRef.current === saveRevision) {
        setSettings((currentSettings) => mergeGeneralSettings(data, currentSettings));
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

  useEffect(() => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    const matchedTab = settingsTabs.find((tab) => tab === tabParam);

    if (matchedTab) {
      setActiveTab(matchedTab);
    }
  }, []);

  function markEdited() {
    editRevisionRef.current += 1;
    setSaveState('idle');
  }

  function updateSetting<Field extends keyof SettingsForm>(
    field: Field,
    value: SettingsForm[Field],
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

  function addCompetitorEntry() {
    const value = competitorDraft.trim();

    if (!value) return;

    const competitor = prepareCompetitor(
      value,
      settings.competitors.map((entry) => entry.value),
    );

    if (!competitor.ok) {
      setCompetitorError(
        validationT(competitorErrorKey(competitor.reason), { max: MAX_COMPETITORS }),
      );
      return;
    }

    setSettings((currentSettings) => ({
      ...currentSettings,
      competitors: [
        ...currentSettings.competitors,
        { id: createEntryId('competitor'), value: competitor.domain },
      ],
    }));
    markEdited();
    setCompetitorDraft('');
    setCompetitorError('');
  }

  function updateAudienceDraft(value: string) {
    setAudienceDraft(value);
    setAudienceError('');
  }

  function addAudienceEntry() {
    const value = audienceDraft.trim();

    if (!value) return;

    if (settings.targetAudience.length >= MAX_TARGET_AUDIENCES) {
      setAudienceError(validationT('targetAudienceMax', { max: MAX_TARGET_AUDIENCES }));
      return;
    }

    setSettings((currentSettings) => ({
      ...currentSettings,
      targetAudience: [...currentSettings.targetAudience, { id: createEntryId('audience'), value }],
    }));
    markEdited();
    setAudienceDraft('');
    setAudienceError('');
  }

  function removeAudienceEntry(id: string) {
    if (!settings.targetAudience.some((audience) => audience.id === id)) return;

    setSettings((currentSettings) => ({
      ...currentSettings,
      targetAudience: currentSettings.targetAudience.filter((audience) => audience.id !== id),
    }));
    markEdited();
    setAudienceError('');
  }

  function removeCompetitorEntry(id: string) {
    setSettings((currentSettings) => ({
      ...currentSettings,
      competitors: currentSettings.competitors.filter((competitor) => competitor.id !== id),
    }));
    markEdited();
    setCompetitorError('');
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

      <div className="overflow-x-auto border-slate-200 border-b">
        <div role="tablist" aria-label={t('tabs.label')} className="flex min-w-max gap-1">
          {settingsTabs.map((tab) => {
            const isActive = activeTab === tab;

            return (
              <button
                key={tab}
                type="button"
                id={`settings-tab-${tab}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={`settings-panel-${tab}`}
                className={cn(
                  'h-10 border-b-2 px-3 font-medium text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/35',
                  isActive
                    ? 'border-slate-950 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-950',
                )}
                onClick={() => setActiveTab(tab)}
              >
                {t(`tabs.${tab}`)}
              </button>
            );
          })}
        </div>
      </div>

      <div
        id="settings-panel-business"
        role="tabpanel"
        aria-labelledby="settings-tab-business"
        hidden={activeTab !== 'business'}
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FieldPanel>
            <Label htmlFor="business-name">{businessT('businessName')}</Label>
            <Input
              className="mt-2"
              id="business-name"
              type="text"
              value={settings.businessName}
              onChange={(event) => updateSetting('businessName', event.target.value)}
            />
          </FieldPanel>

          <FieldPanel>
            <Label htmlFor="language">{businessT('language')}</Label>
            <Select
              value={settings.language}
              onValueChange={(value) => updateSetting('language', value)}
            >
              <SelectTrigger id="language" className="mt-2">
                <SelectValue placeholder={businessT('selectLanguage')} />
              </SelectTrigger>
              <SelectContent>
                {languages.map((language) => (
                  <SelectItem key={language.value} value={language.value}>
                    {optionsT(`languages.${language.labelKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldPanel>

          <FieldPanel>
            <Label htmlFor="country">{businessT('country')}</Label>
            <Select
              value={settings.country}
              onValueChange={(value) => updateSetting('country', value)}
            >
              <SelectTrigger id="country" className="mt-2">
                <SelectValue placeholder={businessT('selectCountry')} />
              </SelectTrigger>
              <SelectContent>
                {countries.map((country) => (
                  <SelectItem key={country.value} value={country.value}>
                    {optionsT(`countries.${country.labelKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldPanel>

          <FieldPanel className="col-span-full">
            <Label htmlFor="business-description">{businessT('businessDescription')}</Label>
            <Textarea
              className="mt-2"
              id="business-description"
              value={settings.businessDescription}
              onChange={(event) => updateSetting('businessDescription', event.target.value)}
              rows={5}
            />
          </FieldPanel>
        </div>
      </div>

      <div
        id="settings-panel-audienceCompetitors"
        role="tabpanel"
        aria-labelledby="settings-tab-audienceCompetitors"
        hidden={activeTab !== 'audienceCompetitors'}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FieldPanel>
            <TextEntryList
              ariaInvalid={Boolean(audienceError)}
              draft={audienceDraft}
              entries={settings.targetAudience}
              errors={audienceError ? [audienceError] : undefined}
              inputId="target-audience"
              label={audienceT('targetAudience')}
              onAdd={addAudienceEntry}
              onDraftChange={updateAudienceDraft}
              onRemove={removeAudienceEntry}
              placeholder={audienceT('targetAudiencePlaceholder')}
            />
          </FieldPanel>

          <FieldPanel>
            <TextEntryList
              ariaInvalid={Boolean(competitorError)}
              description={audienceT('competitorsHelp')}
              draft={competitorDraft}
              entries={settings.competitors}
              errors={competitorError ? [competitorError] : undefined}
              inputId="competitor-url"
              label={audienceT('competitorUrls')}
              onAdd={addCompetitorEntry}
              onDraftChange={setCompetitorDraft}
              onRemove={removeCompetitorEntry}
              placeholder={t('placeholders.competitorUrl')}
            />
            <p className="mt-2 text-gray-500 text-sm">{audienceT('competitorsHint')}</p>
          </FieldPanel>
        </div>
      </div>

      <div
        id="settings-panel-integrations"
        role="tabpanel"
        aria-labelledby="settings-tab-integrations"
        hidden={activeTab !== 'integrations'}
      >
        <IntegrationsPanel organization={organization} onUnauthorized={handleUnauthorized} />
      </div>

      <div
        id="settings-panel-googleSearchConsole"
        role="tabpanel"
        aria-labelledby="settings-tab-googleSearchConsole"
        hidden={activeTab !== 'googleSearchConsole'}
      >
        <GoogleSearchConsolePanel organization={organization} onUnauthorized={handleUnauthorized} />
      </div>

      <div
        id="settings-panel-billing"
        role="tabpanel"
        aria-labelledby="settings-tab-billing"
        hidden={activeTab !== 'billing'}
      >
        <BillingPanel onUnauthorized={handleUnauthorized} organization={organization} />
      </div>

      {SAVEABLE_TABS.has(activeTab) ? (
        <div className="flex justify-end">
          <Button type="submit" disabled={saveSettingsMutation.isPending || !organization}>
            {saveSettingsMutation.isPending ? t('actions.saving') : t('actions.save')}
          </Button>
        </div>
      ) : null}
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
      aria-live="polite"
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

function FieldPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-2 rounded-md border border-slate-200 bg-white p-4', className)}>
      {children}
    </div>
  );
}
