'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { type FormEvent, type ReactNode, useState } from 'react';
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
import { cn } from '@/lib/utils';
import { TextEntryList } from '../../onboarding/components/TextEntryList';
import { countries, languages } from '../../onboarding/constants';
import { integrationOptions } from '../../onboarding/steps/IntegrationsStep';
import type { TextEntry } from '../../onboarding/types';
import { createEntryId, isValidHttpUrl } from '../../onboarding/utils';

const settingsTabs = [
  'business',
  'audienceCompetitors',
  'integrations',
  'googleSearchConsole',
] as const;

type SettingsTab = (typeof settingsTabs)[number];

type SettingsForm = {
  businessDescription: string;
  businessName: string;
  competitors: TextEntry[];
  country: string;
  integrations: string[];
  language: string;
  targetAudience: TextEntry[];
};

const initialSettings: SettingsForm = {
  businessDescription: '',
  businessName: '',
  competitors: [],
  country: countries[0].value,
  integrations: [],
  language: languages[0].value,
  targetAudience: [],
};

export default function SettingsPage() {
  const t = useTranslations('SettingsPage');
  const businessT = useTranslations('Onboarding.business');
  const audienceT = useTranslations('Onboarding.audience');
  const integrationsT = useTranslations('Onboarding.integrations');
  const optionsT = useTranslations('Onboarding.options');
  const validationT = useTranslations('Onboarding.validation');
  const [activeTab, setActiveTab] = useState<SettingsTab>('business');
  const [settings, setSettings] = useState<SettingsForm>(initialSettings);
  const [audienceDraft, setAudienceDraft] = useState('');
  const [competitorDraft, setCompetitorDraft] = useState('');
  const [competitorError, setCompetitorError] = useState('');

  function updateSetting<Field extends keyof SettingsForm>(
    field: Field,
    value: SettingsForm[Field],
  ) {
    setSettings((currentSettings) => ({
      ...currentSettings,
      [field]: value,
    }));
  }

  function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // TODO: Wire this to persisted workspace settings once the product API is available.
  }

  function addAudienceEntry() {
    const value = audienceDraft.trim();

    if (!value) return;

    setSettings((currentSettings) => ({
      ...currentSettings,
      targetAudience: [...currentSettings.targetAudience, { id: createEntryId('audience'), value }],
    }));
    setAudienceDraft('');
  }

  function addCompetitorEntry() {
    const value = competitorDraft.trim();

    if (!value) return;

    if (!isValidHttpUrl(value)) {
      setCompetitorError(validationT('competitorUrl'));
      return;
    }

    setSettings((currentSettings) => ({
      ...currentSettings,
      competitors: [...currentSettings.competitors, { id: createEntryId('competitor'), value }],
    }));
    setCompetitorDraft('');
    setCompetitorError('');
  }

  function removeAudienceEntry(id: string) {
    setSettings((currentSettings) => ({
      ...currentSettings,
      targetAudience: currentSettings.targetAudience.filter((audience) => audience.id !== id),
    }));
  }

  function removeCompetitorEntry(id: string) {
    setSettings((currentSettings) => ({
      ...currentSettings,
      competitors: currentSettings.competitors.filter((competitor) => competitor.id !== id),
    }));
    setCompetitorError('');
  }

  function toggleIntegration(integrationId: string) {
    setSettings((currentSettings) => {
      const selected = currentSettings.integrations.includes(integrationId);

      return {
        ...currentSettings,
        integrations: selected ? [] : [integrationId],
      };
    });
  }

  return (
    <form className="grid w-full gap-4" onSubmit={saveSettings}>
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
              draft={audienceDraft}
              entries={settings.targetAudience}
              inputId="target-audience"
              label={audienceT('targetAudience')}
              onAdd={addAudienceEntry}
              onDraftChange={setAudienceDraft}
              onRemove={removeAudienceEntry}
              placeholder={audienceT('targetAudiencePlaceholder')}
            />
          </FieldPanel>

          <FieldPanel>
            <TextEntryList
              ariaInvalid={Boolean(competitorError)}
              draft={competitorDraft}
              entries={settings.competitors}
              errors={competitorError ? [competitorError] : undefined}
              inputId="competitor-url"
              inputType="url"
              label={audienceT('competitorUrls')}
              onAdd={addCompetitorEntry}
              onDraftChange={setCompetitorDraft}
              onRemove={removeCompetitorEntry}
              placeholder={t('placeholders.competitorUrl')}
            />
          </FieldPanel>
        </div>
      </div>

      <div
        id="settings-panel-integrations"
        role="tabpanel"
        aria-labelledby="settings-tab-integrations"
        hidden={activeTab !== 'integrations'}
      >
        <div className="grid gap-4">
          <FieldPanel>
            <p className="font-medium text-sm leading-none">
              {integrationsT('availableIntegrations')}
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {integrationOptions.map((integration) => {
                const selected = settings.integrations.includes(integration.id);

                return (
                  <Button
                    key={integration.id}
                    type="button"
                    variant="outline"
                    onClick={() => toggleIntegration(integration.id)}
                    aria-pressed={selected}
                    className={cn(
                      'h-auto justify-start gap-3 px-3 py-3 text-left',
                      selected
                        ? 'border-primary bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary'
                        : 'text-foreground',
                    )}
                  >
                    <span className="flex size-9 items-center justify-center">
                      <Image src={integration.logoSrc} alt="" width={20} height={20} aria-hidden />
                    </span>
                    <span className="font-semibold">{integration.name}</span>
                  </Button>
                );
              })}
            </div>
          </FieldPanel>
        </div>
      </div>

      <div
        id="settings-panel-googleSearchConsole"
        role="tabpanel"
        aria-labelledby="settings-tab-googleSearchConsole"
        hidden={activeTab !== 'googleSearchConsole'}
      >
        <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium text-slate-950 text-sm">
              {t('googleSearchConsole.comingSoon')}
            </p>
            <p className="mt-1 text-slate-500 text-sm">{t('googleSearchConsole.description')}</p>
          </div>
          <Button type="button" disabled>
            {t('googleSearchConsole.connect')}
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit">{t('actions.save')}</Button>
      </div>
    </form>
  );
}

function FieldPanel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid gap-2 rounded-md border border-slate-200 bg-white p-4', className)}>
      {children}
    </div>
  );
}
