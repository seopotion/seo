'use client';

import type { SetupPresets, SetupStatus } from '@shared/schemas';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher';
import { Card, CardContent } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { ErrorMessage } from './components/ErrorMessage';
import { ProgressSteps } from './components/ProgressSteps';
import { StepNavigation } from './components/StepNavigation';
import { initialForm, steps } from './constants';
import { ArticleSettingsStep } from './steps/ArticleSettingsStep';
import { AudienceCompetitorsStep } from './steps/AudienceCompetitorsStep';
import { BlogInfoStep } from './steps/BlogInfoStep';
import { BusinessInfoStep } from './steps/BusinessInfoStep';
import { IntegrationsStep } from './steps/IntegrationsStep';
import { WebsiteScanStep } from './steps/WebsiteScanStep';
import type { Errors, OnboardingForm, ScanState } from './types';
import { createEntryId, isValidHttpUrl } from './utils';
import { type ValidationTranslator, validateStep, validateWebsiteUrl } from './validation';

const SETUP_ORG_ID_KEY = 'seo_setup_org_id';
const POLL_INTERVAL_MS = 2500;
const authGuardDisabled =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD === 'true';

type SetupPresetsPatch = {
  business?: Partial<SetupPresets['business']>;
  audience?: Partial<SetupPresets['audience']>;
  blog?: Partial<SetupPresets['blog']>;
  article_preferences?: {
    content_seo?: Partial<SetupPresets['article_preferences']['content_seo']>;
    engagement?: Partial<SetupPresets['article_preferences']['engagement']>;
  };
};

type SetupOrganization = {
  id: string;
  website_url: string;
  setup_status: SetupStatus;
  name?: string;
};

function withHttpScheme(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function formPatchFromPresets(presets: SetupPresets): Partial<OnboardingForm> {
  const targetAudience = presets.audience.target.trim()
    ? [{ id: createEntryId('audience'), value: presets.audience.target }]
    : [];
  const competitors = presets.audience.competitors
    .map(withHttpScheme)
    .filter(Boolean)
    .map((value) => ({ id: createEntryId('competitor'), value }));
  const blogPosts = ['', '', ''];

  presets.blog.best_articles.slice(0, 3).forEach((url, index) => {
    blogPosts[index] = withHttpScheme(url);
  });

  return {
    articleStyle: presets.article_preferences.content_seo.article_style,
    businessDescription: presets.business.description,
    businessName: presets.business.name,
    blogPageUrl: withHttpScheme(presets.blog.main_blog_url),
    blogPosts,
    competitors,
    country: presets.business.country,
    internalLinksCount: presets.article_preferences.content_seo.internal_links ? '1' : '0',
    language: presets.business.language,
    sitemapUrl: withHttpScheme(presets.blog.sitemap_url),
    targetAudience,
  };
}

function buildPresetsPatch(form: OnboardingForm): SetupPresetsPatch {
  return {
    business: {
      name: form.businessName.trim(),
      language: form.language,
      country: form.country,
      description: form.businessDescription.trim(),
    },
    audience: {
      target: form.targetAudience
        .map((entry) => entry.value.trim())
        .filter(Boolean)
        .join(', '),
      competitors: form.competitors.map((entry) => entry.value.trim()).filter(Boolean),
    },
    blog: {
      sitemap_url: form.sitemapUrl.trim(),
      main_blog_url: form.blogPageUrl.trim(),
      best_articles: form.blogPosts.map((url) => url.trim()).filter(Boolean),
    },
    article_preferences: {
      content_seo: {
        article_style: form.articleStyle,
        internal_links: form.internalLinksCount !== '0',
        llm_instructions: form.businessDescription.trim(),
      },
    },
  };
}

export default function OnboardingPage() {
  const router = useRouter();
  const t = useTranslations('Onboarding');
  const validationT = useTranslations('Onboarding.validation') as ValidationTranslator;
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [form, setForm] = useState<OnboardingForm>(initialForm);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [setupStatus, setSetupStatus] = useState<SetupStatus | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [audienceDraft, setAudienceDraft] = useState('');
  const [competitorDraft, setCompetitorDraft] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [isFinishing, setIsFinishing] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: restore saved setup progress once on mount.
  useEffect(() => {
    let ignore = false;

    async function restoreSetupProgress() {
      if (authGuardDisabled && !getToken()) return;

      const storedOrgId = window.localStorage.getItem(SETUP_ORG_ID_KEY);

      try {
        if (storedOrgId) {
          if (ignore) return;
          setOrgId(storedOrgId);
          await refreshSetupStatus(storedOrgId);
          return;
        }

        const orgsRes = await api.api.v0.core.organizations.$get();
        if (!orgsRes.ok || ignore) return;

        const { organizations } = await orgsRes.json();
        const activeOrg = (organizations as SetupOrganization[]).find(
          (organization) => organization.setup_status !== 'setup_complete',
        );

        if (!activeOrg) return;

        window.localStorage.setItem(SETUP_ORG_ID_KEY, activeOrg.id);
        setOrgId(activeOrg.id);
        setSetupStatus(activeOrg.setup_status);
        setForm((currentForm) => ({
          ...currentForm,
          websiteUrl: currentForm.websiteUrl || activeOrg.website_url,
        }));

        if (activeOrg.setup_status === 'setup_scan_completed') {
          setScanState('complete');
          await loadSetupDetails(activeOrg.id);
        } else if (activeOrg.setup_status === 'setup_scan_in_progress') {
          setScanState('scanning');
          scheduleStatusPoll(activeOrg.id);
        }
      } catch {
        window.localStorage.removeItem(SETUP_ORG_ID_KEY);
      }
    }

    void restoreSetupProgress();

    return () => {
      ignore = true;
      stopPolling();
    };
  }, []);

  function stopPolling() {
    if (pollTimer.current) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }

  function scheduleStatusPoll(nextOrgId: string) {
    stopPolling();
    pollTimer.current = setTimeout(() => {
      void refreshSetupStatus(nextOrgId);
    }, POLL_INTERVAL_MS);
  }

  async function loadSetupDetails(nextOrgId: string) {
    try {
      const detailsRes = await api.api.v0.setup.details.$get({ query: { org_id: nextOrgId } });

      if (!detailsRes.ok) {
        setErrors((currentErrors) => ({
          ...currentErrors,
          scan: t('errors.generatedDetailsPending'),
        }));
        return;
      }

      const { presets } = await detailsRes.json();
      setForm((currentForm) => ({ ...currentForm, ...formPatchFromPresets(presets) }));
      clearErrors('scan');
    } catch {
      setErrors((currentErrors) => ({
        ...currentErrors,
        scan: t('errors.loadGeneratedDetails'),
      }));
    }
  }

  async function refreshSetupStatus(nextOrgId: string) {
    try {
      const statusRes = await api.api.v0.setup.status.$get({ query: { org_id: nextOrgId } });

      if (!statusRes.ok) {
        setScanState('idle');
        setErrors((currentErrors) => ({
          ...currentErrors,
          scan: t('errors.checkScanStatus'),
        }));
        return;
      }

      const { setup_status } = await statusRes.json();
      setSetupStatus(setup_status);

      if (setup_status === 'setup_complete') {
        window.localStorage.removeItem(SETUP_ORG_ID_KEY);
        router.replace('/home');
        return;
      }

      if (setup_status === 'setup_scan_completed') {
        stopPolling();
        setScanState('complete');
        await loadSetupDetails(nextOrgId);
        return;
      }

      if (setup_status === 'setup_scan_in_progress') {
        setScanState('scanning');
        scheduleStatusPoll(nextOrgId);
        return;
      }

      stopPolling();
      setScanState('idle');
    } catch {
      stopPolling();
      setScanState('idle');
      setErrors((currentErrors) => ({
        ...currentErrors,
        scan: t('errors.reachSetupApi'),
      }));
    }
  }

  function clearErrors(...keys: string[]) {
    setErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      let changed = false;

      for (const key of keys) {
        if (key in nextErrors) {
          delete nextErrors[key];
          changed = true;
        }
      }

      return changed ? nextErrors : currentErrors;
    });
  }

  function updateField<Field extends keyof OnboardingForm>(
    field: Field,
    value: OnboardingForm[Field],
    errorKeys: string[] = [field],
  ) {
    setForm((currentForm) => ({ ...currentForm, [field]: value }));
    clearErrors(...errorKeys);
  }

  function updateWebsiteUrl(value: string) {
    updateField('websiteUrl', value, ['websiteUrl', 'scan']);
    setOrgId(null);
    setSetupStatus(null);
    setScanState('idle');
    stopPolling();
    window.localStorage.removeItem(SETUP_ORG_ID_KEY);
  }

  function updateBlogPost(index: number, value: string) {
    setForm((currentForm) => {
      const blogPosts = [...currentForm.blogPosts];
      blogPosts[index] = value;
      return { ...currentForm, blogPosts };
    });
    clearErrors(`blogPost${index}`);
  }

  function updateAudienceDraft(value: string) {
    setAudienceDraft(value);
    clearErrors('targetAudience');
  }

  function updateCompetitorDraft(value: string) {
    setCompetitorDraft(value);
    clearErrors('competitorDraft', 'competitors');
  }

  function getStepErrors() {
    return validateStep({
      audienceDraft,
      competitorDraft,
      form,
      scanState,
      stepIndex: currentStep,
      t: validationT,
    });
  }

  function commitDraftEntries() {
    const audienceValue = audienceDraft.trim();
    const competitorValue = competitorDraft.trim();

    if (!audienceValue && !competitorValue) return;

    setForm((currentForm) => ({
      ...currentForm,
      targetAudience: audienceValue
        ? [...currentForm.targetAudience, { id: createEntryId('audience'), value: audienceValue }]
        : currentForm.targetAudience,
      competitors: competitorValue
        ? [...currentForm.competitors, { id: createEntryId('competitor'), value: competitorValue }]
        : currentForm.competitors,
    }));
    setAudienceDraft('');
    setCompetitorDraft('');
  }

  function goToStep(stepIndex: number) {
    if (stepIndex > currentStep) return;

    setCurrentStep(stepIndex);
    setErrors({});
  }

  async function handleScanWebsite() {
    const websiteError = validateWebsiteUrl(form.websiteUrl, validationT);

    if (websiteError) {
      setErrors((currentErrors) => ({ ...currentErrors, websiteUrl: websiteError }));
      return;
    }

    setErrors((currentErrors) => {
      const nextErrors = { ...currentErrors };
      delete nextErrors.websiteUrl;
      delete nextErrors.scan;
      return nextErrors;
    });
    stopPolling();
    setScanState('scanning');
    setSetupStatus('setup_scan_in_progress');

    try {
      const startRes = await api.api.v0.setup.start_scan.$post({
        json: { website_url: form.websiteUrl.trim() },
      });

      if (!startRes.ok) {
        throw new Error('start_scan failed');
      }

      const data = await startRes.json();
      window.localStorage.setItem(SETUP_ORG_ID_KEY, data.org_id);
      setOrgId(data.org_id);
      setSetupStatus(data.setup_status);
      await refreshSetupStatus(data.org_id);
    } catch {
      setScanState('idle');
      setErrors((currentErrors) => ({
        ...currentErrors,
        scan: t('errors.startScan'),
      }));
    }
  }

  function handleBack() {
    if (currentStep === 0) return;

    setCurrentStep((step) => step - 1);
    setErrors({});
  }

  function handleNext() {
    const nextErrors = getStepErrors();

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    if (currentStep === 2) commitDraftEntries();

    setCurrentStep((step) => Math.min(step + 1, steps.length - 1));
    setErrors({});
  }

  async function handleFinish() {
    const nextErrors = getStepErrors();

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    if (!orgId || scanState !== 'complete') {
      setErrors((currentErrors) => ({
        ...currentErrors,
        finalize: t('errors.completeScanBeforeFinalize'),
      }));
      return;
    }

    setIsFinishing(true);
    setErrors({});

    try {
      const finalizeRes = await api.api.v0.setup.finalize.$post({
        json: { org_id: orgId, presets: buildPresetsPatch(form) },
      });

      if (!finalizeRes.ok) {
        throw new Error('finalize failed');
      }

      window.localStorage.removeItem(SETUP_ORG_ID_KEY);
      router.replace('/home');
    } catch {
      setErrors((currentErrors) => ({
        ...currentErrors,
        finalize: t('errors.finalize'),
      }));
    } finally {
      setIsFinishing(false);
    }
  }

  function addAudienceEntry() {
    const value = audienceDraft.trim();

    if (!value) return;

    setForm((currentForm) => ({
      ...currentForm,
      targetAudience: [...currentForm.targetAudience, { id: createEntryId('audience'), value }],
    }));
    setAudienceDraft('');
    clearErrors('targetAudience');
  }

  function addCompetitorEntry() {
    const value = competitorDraft.trim();

    if (!value) return;

    if (!isValidHttpUrl(value)) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        competitorDraft: validationT('competitorUrl'),
      }));
      return;
    }

    setForm((currentForm) => ({
      ...currentForm,
      competitors: [...currentForm.competitors, { id: createEntryId('competitor'), value }],
    }));
    setCompetitorDraft('');
    clearErrors('competitorDraft', 'competitors');
  }

  function removeAudienceEntry(id: string) {
    setForm((currentForm) => ({
      ...currentForm,
      targetAudience: currentForm.targetAudience.filter((audience) => audience.id !== id),
    }));
  }

  function removeCompetitorEntry(id: string) {
    setForm((currentForm) => ({
      ...currentForm,
      competitors: currentForm.competitors.filter((competitor) => competitor.id !== id),
    }));
    clearErrors('competitors');
  }

  function toggleIntegration(integrationId: string) {
    setForm((currentForm) => {
      const selected = currentForm.integrations.includes(integrationId);

      return {
        ...currentForm,
        integrations: selected ? [] : [integrationId],
      };
    });
  }

  function renderCurrentStep() {
    if (currentStep === 0) {
      return (
        <WebsiteScanStep
          errors={errors}
          form={form}
          onScanWebsite={() => void handleScanWebsite()}
          onWebsiteUrlChange={updateWebsiteUrl}
          orgId={orgId}
          scanState={scanState}
          setupStatus={setupStatus}
        />
      );
    }

    if (currentStep === 1) {
      return <BusinessInfoStep errors={errors} form={form} updateField={updateField} />;
    }

    if (currentStep === 2) {
      return (
        <AudienceCompetitorsStep
          audienceDraft={audienceDraft}
          competitorDraft={competitorDraft}
          errors={errors}
          form={form}
          onAddAudience={addAudienceEntry}
          onAddCompetitor={addCompetitorEntry}
          onAudienceDraftChange={updateAudienceDraft}
          onCompetitorDraftChange={updateCompetitorDraft}
          onRemoveAudience={removeAudienceEntry}
          onRemoveCompetitor={removeCompetitorEntry}
        />
      );
    }

    if (currentStep === 3) {
      return (
        <BlogInfoStep
          errors={errors}
          form={form}
          updateBlogPost={updateBlogPost}
          updateField={updateField}
        />
      );
    }

    if (currentStep === 4) {
      return <ArticleSettingsStep errors={errors} form={form} updateField={updateField} />;
    }

    return (
      <IntegrationsStep
        form={form}
        toggleIntegration={toggleIntegration}
        updateField={updateField}
      />
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="font-semibold text-primary text-sm">{t('eyebrow')}</p>
            <h1 className="mt-1 font-bold text-3xl text-gray-900">{t('title')}</h1>
          </div>
          <LocaleSwitcher />
        </div>

        <ProgressSteps
          currentStep={currentStep}
          onStepClick={goToStep}
          steps={steps.map((step) => t(`steps.${step}`))}
        />

        <Card>
          <CardContent>
            {renderCurrentStep()}
            <StepNavigation
              currentStep={currentStep}
              finishLabel={isFinishing ? t('actions.finalizing') : t('actions.getStarted')}
              isFinalStep={currentStep === steps.length - 1}
              isFinishDisabled={isFinishing}
              isNextDisabled={scanState === 'scanning' || isFinishing}
              onBack={handleBack}
              onFinish={() => void handleFinish()}
              onNext={handleNext}
            />
            <ErrorMessage>{errors.finalize}</ErrorMessage>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
