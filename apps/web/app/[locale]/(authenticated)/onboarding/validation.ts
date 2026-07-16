import type { Errors, OnboardingForm, ScanState } from './types';
import { isValidHttpUrl } from './utils';

export type ValidationTranslator = (
  key: string,
  values?: Record<string, number | string>,
) => string;

export function validateWebsiteUrl(value: string, t: ValidationTranslator) {
  if (!value.trim()) return t('websiteRequired');
  if (!isValidHttpUrl(value)) return t('urlWithProtocol');
  return '';
}

function validateRequiredUrl(value: string, label: string, t: ValidationTranslator) {
  if (!value.trim()) return t('required', { label });
  if (!isValidHttpUrl(value)) return t('validUrl', { label: label.toLowerCase() });
  return '';
}

function validateOptionalUrl(value: string, label: string, t: ValidationTranslator) {
  if (!value.trim()) return '';
  if (!isValidHttpUrl(value)) return t('validUrl', { label: label.toLowerCase() });
  return '';
}

export function validateStep({
  audienceDraft,
  competitorDraft,
  form,
  scanState,
  stepIndex,
  t,
}: {
  audienceDraft: string;
  competitorDraft: string;
  form: OnboardingForm;
  scanState: ScanState;
  stepIndex: number;
  t: ValidationTranslator;
}) {
  const nextErrors: Errors = {};

  if (stepIndex === 0) {
    const websiteError = validateWebsiteUrl(form.websiteUrl, t);
    if (websiteError) nextErrors.websiteUrl = websiteError;
    if (!websiteError && scanState !== 'complete') {
      nextErrors.scan = t('scanBeforeContinuing');
    }
  }

  if (stepIndex === 1) {
    if (!form.businessName.trim()) nextErrors.businessName = t('businessNameRequired');
    if (!form.language) nextErrors.language = t('languageRequired');
    if (!form.country) nextErrors.country = t('countryRequired');
  }

  if (stepIndex === 2) {
    if (!audienceDraft.trim() && form.targetAudience.length === 0) {
      nextErrors.targetAudience = t('targetAudienceRequired');
    }

    if (competitorDraft.trim() && !isValidHttpUrl(competitorDraft)) {
      nextErrors.competitorDraft = t('competitorUrl');
    }

    if (form.competitors.some((competitor) => !isValidHttpUrl(competitor.value))) {
      nextErrors.competitors = t('competitorsValidUrls');
    }
  }

  if (stepIndex === 3) {
    const sitemapError = validateRequiredUrl(form.sitemapUrl, t('labels.sitemapUrl'), t);
    const blogPageError = validateRequiredUrl(form.blogPageUrl, t('labels.blogPageUrl'), t);

    if (sitemapError) nextErrors.sitemapUrl = sitemapError;
    if (blogPageError) nextErrors.blogPageUrl = blogPageError;

    form.blogPosts.forEach((postUrl, index) => {
      const postError = validateOptionalUrl(
        postUrl,
        t('labels.blogPostUrl', { index: index + 1 }),
        t,
      );
      if (postError) nextErrors[`blogPost${index}`] = postError;
    });
  }

  if (stepIndex === 4) {
    if (!form.articleStyle) nextErrors.articleStyle = t('articleStyleRequired');
  }

  return nextErrors;
}
