'use client';

import { useEffect, useRef, useState } from 'react';
import { FinishedState } from './components/FinishedState';
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
import { buildMockBusinessDescription, createEntryId, isValidHttpUrl } from './utils';
import { validateStep, validateWebsiteUrl } from './validation';

export default function OnboardingPage() {
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [form, setForm] = useState<OnboardingForm>(initialForm);
  const [scanState, setScanState] = useState<ScanState>('idle');
  const [audienceDraft, setAudienceDraft] = useState('');
  const [competitorDraft, setCompetitorDraft] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    return () => {
      if (scanTimer.current) clearTimeout(scanTimer.current);
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
    updateField('websiteUrl', value, ['websiteUrl', 'scan']);
    setScanState('idle');

    if (scanTimer.current) {
      clearTimeout(scanTimer.current);
      scanTimer.current = null;
    }
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

  function handleScanWebsite() {
    const websiteError = validateWebsiteUrl(form.websiteUrl);

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

    if (scanTimer.current) clearTimeout(scanTimer.current);

    scanTimer.current = setTimeout(() => {
      setScanState('complete');
      setForm((currentForm) => ({
        ...currentForm,
        businessDescription: buildMockBusinessDescription(currentForm.websiteUrl),
      }));
      scanTimer.current = null;
    }, 1200);
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

  function handleFinish() {
    const nextErrors = getStepErrors();

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setFinished(true);
    setErrors({});
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
        competitorDraft: 'Enter a valid competitor URL.',
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
        integrations: selected
          ? currentForm.integrations.filter((id) => id !== integrationId)
          : [...currentForm.integrations, integrationId],
      };
    });
  }

  function resetOnboarding() {
    setForm(initialForm);
    setCurrentStep(0);
    setScanState('idle');
    setFinished(false);
    setAudienceDraft('');
    setCompetitorDraft('');
    setErrors({});
  }

  function renderCurrentStep() {
    if (currentStep === 0) {
      return (
        <WebsiteScanStep
          errors={errors}
          form={form}
          onScanWebsite={handleScanWebsite}
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

  if (finished) {
    return (
      <FinishedState onReviewAnswers={() => setFinished(false)} onStartOver={resetOnboarding} />
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6">
          <p className="font-semibold text-primary text-sm">Setup</p>
          <h1 className="mt-1 font-bold text-3xl text-gray-900">Create your SEO workspace</h1>
        </div>

        <ProgressSteps currentStep={currentStep} onStepClick={goToStep} steps={steps} />

        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-xs sm:p-6">
          {renderCurrentStep()}
          <StepNavigation
            currentStep={currentStep}
            isFinalStep={currentStep === steps.length - 1}
            isNextDisabled={scanState === 'scanning'}
            onBack={handleBack}
            onFinish={handleFinish}
            onNext={handleNext}
          />
        </section>
      </div>
    </main>
  );
}
