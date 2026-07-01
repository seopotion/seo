import type { Errors, OnboardingForm, ScanState } from './types';
import { isValidHttpUrl } from './utils';

export function validateWebsiteUrl(value: string) {
  if (!value.trim()) return 'Website URL is required.';
  if (!isValidHttpUrl(value)) return 'Enter a valid URL starting with http or https.';
  return '';
}

function validateRequiredUrl(value: string, label: string) {
  if (!value.trim()) return `${label} is required.`;
  if (!isValidHttpUrl(value)) return `Enter a valid ${label.toLowerCase()}.`;
  return '';
}

function validateOptionalUrl(value: string, label: string) {
  if (!value.trim()) return '';
  if (!isValidHttpUrl(value)) return `Enter a valid ${label.toLowerCase()}.`;
  return '';
}

export function validateStep({
  audienceDraft,
  competitorDraft,
  form,
  scanState,
  stepIndex,
}: {
  audienceDraft: string;
  competitorDraft: string;
  form: OnboardingForm;
  scanState: ScanState;
  stepIndex: number;
}) {
  const nextErrors: Errors = {};

  if (stepIndex === 0) {
    const websiteError = validateWebsiteUrl(form.websiteUrl);
    if (websiteError) nextErrors.websiteUrl = websiteError;
    if (!websiteError && scanState !== 'complete') {
      nextErrors.scan = 'Scan the website before continuing.';
    }
  }

  if (stepIndex === 1) {
    if (!form.businessName.trim()) nextErrors.businessName = 'Business name is required.';
    if (!form.language) nextErrors.language = 'Language is required.';
    if (!form.country) nextErrors.country = 'Country is required.';
  }

  if (stepIndex === 2) {
    if (!audienceDraft.trim() && form.targetAudience.length === 0) {
      nextErrors.targetAudience = 'Add at least one target audience.';
    }

    if (competitorDraft.trim() && !isValidHttpUrl(competitorDraft)) {
      nextErrors.competitorDraft = 'Enter a valid competitor URL.';
    }

    if (form.competitors.some((competitor) => !isValidHttpUrl(competitor.value))) {
      nextErrors.competitors = 'Each competitor must be a valid URL.';
    }
  }

  if (stepIndex === 3) {
    const sitemapError = validateRequiredUrl(form.sitemapUrl, 'Sitemap URL');
    const blogPageError = validateRequiredUrl(form.blogPageUrl, 'Blog page URL');

    if (sitemapError) nextErrors.sitemapUrl = sitemapError;
    if (blogPageError) nextErrors.blogPageUrl = blogPageError;

    form.blogPosts.forEach((postUrl, index) => {
      const postError = validateOptionalUrl(postUrl, `blog post ${index + 1} URL`);
      if (postError) nextErrors[`blogPost${index}`] = postError;
    });
  }

  if (stepIndex === 4) {
    if (!form.articleStyle) nextErrors.articleStyle = 'Article style is required.';
  }

  return nextErrors;
}
