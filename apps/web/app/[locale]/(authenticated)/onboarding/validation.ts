import { MAX_COMPETITORS, normalizeCompetitorDomain } from './competitors';
import { MAX_TARGET_AUDIENCES } from './constants';
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
  competitorsSkipped = false,
  form,
  scanState,
  stepIndex,
  t,
}: {
  audienceDraft: string;
  competitorDraft: string;
  /** Set by the deliberate "no competitor to name" opt-out on step 2. */
  competitorsSkipped?: boolean;
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
    } else if (form.targetAudience.length + (audienceDraft.trim() ? 1 : 0) > MAX_TARGET_AUDIENCES) {
      nextErrors.targetAudience = t('targetAudienceMax', { max: MAX_TARGET_AUDIENCES });
    }

    const competitorCount = form.competitors.length + (competitorDraft.trim() ? 1 : 0);

    if (competitorDraft.trim() && !normalizeCompetitorDomain(competitorDraft).ok) {
      nextErrors.competitorDraft = t('competitorDomain');
    }

    if (competitorCount === 0) {
      // Competitors drive a whole third of the keyword pipeline, so advancing
      // without them has to be a choice the user made, not a silent default.
      if (!competitorsSkipped) nextErrors.competitors = t('competitorsRequired');
    } else if (competitorCount > MAX_COMPETITORS) {
      nextErrors.competitors = t('competitorsMax', { max: MAX_COMPETITORS });
    } else if (
      form.competitors.some((competitor) => !normalizeCompetitorDomain(competitor.value).ok)
    ) {
      nextErrors.competitors = t('competitorsValidDomains');
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
