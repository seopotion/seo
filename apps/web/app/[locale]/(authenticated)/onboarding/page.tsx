'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LocaleSwitcher } from '@/components/i18n/LocaleSwitcher';
import { Button, Card, CardContent } from '@/components/ui';
import { Link, useRouter } from '@/i18n/navigation';
import { setActiveOrganizationId } from '@/lib/active-organization';
import { clearToken, getToken } from '@/lib/auth';
import { dashboardQueryKeys } from '@/lib/dashboard-query-keys';
import { useConnectedIntegrations } from '@/lib/integrations';
import {
  clearWorkspaceStatusCache,
  getWorkspaceStatus,
  setWorkspaceStatusCache,
} from '@/lib/session';
import { completeOnboarding, OnboardingApiError, scanWebsiteForOnboarding } from './api';
import { competitorErrorKey, MAX_COMPETITORS, prepareCompetitor } from './competitors';
import { ErrorMessage } from './components/ErrorMessage';
import { ProgressSteps } from './components/ProgressSteps';
import { StepNavigation } from './components/StepNavigation';
import { initialForm, MAX_TARGET_AUDIENCES, steps } from './constants';
import { clearOnboardingIntegrations, toOnboardingIntegrationIds } from './integrations';
import { ArticleSettingsStep } from './steps/ArticleSettingsStep';
import { AudienceCompetitorsStep } from './steps/AudienceCompetitorsStep';
import { BlogInfoStep } from './steps/BlogInfoStep';
import { BusinessInfoStep } from './steps/BusinessInfoStep';
import { IntegrationsStep } from './steps/IntegrationsStep';
import { WebsiteScanStep } from './steps/WebsiteScanStep';
import type { Errors, OnboardingForm, ScanState } from './types';
import { createEntryId } from './utils';
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
  const queryClient = useQueryClient();
  // `?new=1` is the switcher's "Add website": the user already has a complete
  // org and must not be bounced to /home. Read once, the way settings reads
  // `?tab=` — useSearchParams would force a Suspense boundary on this page.
  const [isAddingWebsite] = useState(
    () =>
      typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).get('new') === '1',
  );
  const [audienceDraft, setAudienceDraft] = useState('');
  const [competitorDraft, setCompetitorDraft] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [isFinishing, setIsFinishing] = useState(false);
  const [workspaceGate, setWorkspaceGate] = useState<'checking' | 'error' | 'ready'>('checking');
  const scanRunIdRef = useRef(0);

  const handleUnauthorized = useCallback(() => {
    clearToken();
    clearWorkspaceStatusCache();
    router.replace('/');
  }, [router]);

  const connectedIntegrationsQuery = useConnectedIntegrations(orgId, {
    onUnauthorized: handleUnauthorized,
  });
  const connectedIntegrationIds = useMemo(
    () =>
      connectedIntegrationsQuery.data
        ? toOnboardingIntegrationIds(connectedIntegrationsQuery.data.integrations)
        : [],
    [connectedIntegrationsQuery.data],
  );

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

      if (status.setupComplete && !isAddingWebsite) {
        router.replace('/home', { locale });
        return;
      }

      setWorkspaceGate('ready');
    },
    [isAddingWebsite, locale, router],
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

  useEffect(() => {
    if (!connectedIntegrationsQuery.isSuccess || connectedIntegrationsQuery.isFetching) return;

    setForm((currentForm) => {
      if (
        currentForm.integrations.length === connectedIntegrationIds.length &&
        currentForm.integrations.every((integration) =>
          connectedIntegrationIds.includes(integration),
        )
      ) {
        return currentForm;
      }

      return { ...currentForm, integrations: connectedIntegrationIds };
    });
  }, [
    connectedIntegrationIds,
    connectedIntegrationsQuery.isFetching,
    connectedIntegrationsQuery.isSuccess,
  ]);

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
    setForm((currentForm) => ({
      ...clearOnboardingIntegrations(currentForm),
      websiteUrl: value,
    }));
    clearErrors('websiteUrl', 'scan');
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

    setForm((currentForm) => {
      const canAddAudience =
        audienceValue && currentForm.targetAudience.length < MAX_TARGET_AUDIENCES;

      const competitor = competitorValue
        ? prepareCompetitor(
            competitorValue,
            currentForm.competitors.map((entry) => entry.value),
          )
        : null;

      return {
        ...currentForm,
        targetAudience: canAddAudience
          ? [...currentForm.targetAudience, { id: createEntryId('audience'), value: audienceValue }]
          : currentForm.targetAudience,
        competitors: competitor?.ok
          ? [
              ...currentForm.competitors,
              { id: createEntryId('competitor'), value: competitor.domain },
            ]
          : currentForm.competitors,
      };
    });
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
    setForm(clearOnboardingIntegrations);

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
      const integrationsResult = await connectedIntegrationsQuery.refetch();
      if (integrationsResult.isError || !integrationsResult.data) {
        throw new OnboardingApiError('request_failed');
      }

      const verifiedIntegrations = toOnboardingIntegrationIds(integrationsResult.data.integrations);
      await completeOnboarding(orgId, form, verifiedIntegrations);
      const workspaceStatus = await getWorkspaceStatus({ useCache: false });

      if (!workspaceStatus.ok && workspaceStatus.reason === 'unauthorized') {
        clearToken();
        clearWorkspaceStatusCache();
        router.replace('/');
        return;
      }

      setWorkspaceStatusCache(workspaceStatus.ok ? workspaceStatus.setupComplete : true);
      // The shell must mount on the org we just finished. The cached org list
      // (5 min staleTime) predates it, so drop it rather than let the selector
      // fall back to the previous org.
      setActiveOrganizationId(orgId);
      queryClient.removeQueries({ queryKey: dashboardQueryKeys.organizations() });
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

    if (form.targetAudience.length >= MAX_TARGET_AUDIENCES) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        targetAudience: validationT('targetAudienceMax', { max: MAX_TARGET_AUDIENCES }),
      }));
      return;
    }

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

    const competitor = prepareCompetitor(
      value,
      form.competitors.map((entry) => entry.value),
    );

    if (!competitor.ok) {
      setErrors((currentErrors) => ({
        ...currentErrors,
        competitorDraft: validationT(competitorErrorKey(competitor.reason), {
          max: MAX_COMPETITORS,
        }),
      }));
      return;
    }

    setForm((currentForm) => ({
      ...currentForm,
      competitors: [
        ...currentForm.competitors,
        { id: createEntryId('competitor'), value: competitor.domain },
      ],
    }));
    setCompetitorDraft('');
    clearErrors('competitorDraft', 'competitors');
  }

  function removeAudienceEntry(id: string) {
    setForm((currentForm) => ({
      ...currentForm,
      targetAudience: currentForm.targetAudience.filter((audience) => audience.id !== id),
    }));
    clearErrors('targetAudience');
  }

  function removeCompetitorEntry(id: string) {
    setForm((currentForm) => ({
      ...currentForm,
      competitors: currentForm.competitors.filter((competitor) => competitor.id !== id),
    }));
    clearErrors('competitors');
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
        connectedIntegrationIds={connectedIntegrationIds}
        form={form}
        integrationsError={connectedIntegrationsQuery.isError}
        integrationsLoading={connectedIntegrationsQuery.isFetching}
        onUnauthorized={handleUnauthorized}
        onRetryIntegrations={() => void connectedIntegrationsQuery.refetch()}
        organizationId={orgId}
        updateField={updateField}
      />
    );
  }

  if (workspaceGate === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/50 px-4">
        <p className="font-medium text-muted-foreground text-sm">{t('checkingWorkspace')}</p>
      </main>
    );
  }

  if (workspaceGate === 'error') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-muted/50 px-4 text-center">
        <p className="font-medium text-muted-foreground text-sm">{t('errors.checkWorkspace')}</p>
        <Button onClick={() => void checkWorkspaceGate()} variant="outline">
          {t('actions.retry')}
        </Button>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted/50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            {isAddingWebsite ? (
              <Link
                href="/home"
                className="mb-2 inline-block text-muted-foreground text-sm hover:text-foreground"
              >
                ← {t('actions.backToDashboard')}
              </Link>
            ) : null}
            <p className="font-semibold text-primary text-sm">{t('eyebrow')}</p>
            <h1 className="mt-1 font-bold text-3xl text-foreground">{t('title')}</h1>
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
              isFinishDisabled={isFinishing || connectedIntegrationsQuery.isFetching}
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
