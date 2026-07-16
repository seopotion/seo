'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher';
import { Button, Card, CardContent } from '@/components/ui';
import { useRouter } from '@/i18n/navigation';
import { clearToken, getToken } from '@/lib/auth';
import {
  clearWorkspaceStatusCache,
  getWorkspaceStatus,
  setWorkspaceStatusCache,
} from '@/lib/session';
import { completeOnboarding, OnboardingApiError, scanWebsiteForOnboarding } from './api';
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

const authGuardDisabled =
  process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DISABLE_AUTH_GUARD === 'true';

export default function OnboardingPage() {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations('Onboarding');
  const validationT = useTranslations('Onboarding.validation') as ValidationTranslator;
  const [currentStep, setCurrentStep] = useState(0);
  const [form, setForm] = useState<OnboardingForm>(initialForm);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [audienceDraft, setAudienceDraft] = useState('');
  const [competitorDraft, setCompetitorDraft] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [isFinishing, setIsFinishing] = useState(false);
  const [workspaceGate, setWorkspaceGate] = useState<'checking' | 'error' | 'ready'>('checking');
  const scanRunIdRef = useRef(0);

  const checkWorkspaceGate = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      if (authGuardDisabled && !getToken()) {
        setWorkspaceGate('ready');
        return;
      }

      setWorkspaceGate('checking');

      const status = await getWorkspaceStatus();

      if (isCancelled()) return;

      if (!status.ok) {
        if (status.reason === 'unauthorized') {
          clearToken();
          clearWorkspaceStatusCache();
          router.replace('/');
          return;
        }

        setWorkspaceGate('error');
        return;
      }

      if (status.setupComplete) {
        router.replace('/home', { locale });
        return;
      }

      setWorkspaceGate('ready');
    },
    [locale, router],
  );

  useEffect(() => {
    let ignore = false;

    void checkWorkspaceGate(() => ignore);

    return () => {
      ignore = true;
    };
  }, [checkWorkspaceGate]);

  useEffect(() => {
    return () => {
      scanRunIdRef.current += 1;
    };
  }, []);

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
    scanRunIdRef.current += 1;
    updateField('websiteUrl', value, ['websiteUrl', 'scan']);
    setOrgId(null);
    setScanState('idle');
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
    setScanState('scanning');
    setOrgId(null);

    const scanRunId = scanRunIdRef.current + 1;
    scanRunIdRef.current = scanRunId;
    const websiteUrl = form.websiteUrl.trim();

    try {
      const scanResult = await scanWebsiteForOnboarding(websiteUrl);

      if (scanRunIdRef.current !== scanRunId) return;

      setForm((currentForm) => ({
        ...currentForm,
        ...scanResult.formPatch,
      }));
      setOrgId(scanResult.orgId);
      setScanState('complete');
      clearErrors('scan', 'businessDescription', 'targetAudience');
    } catch (error) {
      if (scanRunIdRef.current !== scanRunId) return;

      if (error instanceof OnboardingApiError && error.reason === 'unauthorized') {
        clearToken();
        clearWorkspaceStatusCache();
        router.replace('/');
        return;
      }

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

    if (scanState !== 'complete' || !orgId) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        finalize: t('errors.completeScanBeforeFinalize'),
      }));
      return;
    }

    setIsFinishing(true);
    setErrors({});

    try {
      await completeOnboarding(orgId, form);
      const workspaceStatus = await getWorkspaceStatus({ useCache: false });

      if (!workspaceStatus.ok && workspaceStatus.reason === 'unauthorized') {
        clearToken();
        clearWorkspaceStatusCache();
        router.replace('/');
        return;
      }

      setWorkspaceStatusCache(workspaceStatus.ok ? workspaceStatus.setupComplete : true);
      router.replace('/home', { locale });
    } catch (error) {
      if (error instanceof OnboardingApiError && error.reason === 'unauthorized') {
        clearToken();
        clearWorkspaceStatusCache();
        router.replace('/');
        return;
      }

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
          scanState={scanState}
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

  if (workspaceGate === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
        <p className="font-medium text-gray-600 text-sm">{t('checkingWorkspace')}</p>
      </main>
    );
  }

  if (workspaceGate === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-4 text-center">
        <p className="font-medium text-gray-600 text-sm">{t('errors.checkWorkspace')}</p>
        <Button onClick={() => void checkWorkspaceGate()} variant="outline">
          {t('actions.retry')}
        </Button>
      </main>
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
