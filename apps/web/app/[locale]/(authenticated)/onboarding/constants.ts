import type { OnboardingForm } from './types';

export const MAX_TARGET_AUDIENCES = 7;

export const steps = [
  'websiteScan',
  'businessInfo',
  'audienceCompetitors',
  'blogInfo',
  'articleSettings',
  'integrations',
] as const;

export const languages = [
  { value: 'English', labelKey: 'english' },
  { value: 'Turkish', labelKey: 'turkish' },
  { value: 'Spanish', labelKey: 'spanish' },
  { value: 'German', labelKey: 'german' },
  { value: 'French', labelKey: 'french' },
] as const;

export const countries = [
  { value: 'Global (English)', labelKey: 'globalEnglish' },
  { value: 'United States', labelKey: 'unitedStates' },
  { value: 'Turkey', labelKey: 'turkey' },
  { value: 'United Kingdom', labelKey: 'unitedKingdom' },
  { value: 'Canada', labelKey: 'canada' },
  { value: 'Germany', labelKey: 'germany' },
  { value: 'France', labelKey: 'france' },
] as const;

export const articleStyles = [
  { value: 'Informative', labelKey: 'informative' },
  { value: 'Informative, practical, SEO-optimized', labelKey: 'informativePracticalSeo' },
  { value: 'Casual', labelKey: 'casual' },
  { value: 'Professional', labelKey: 'professional' },
  { value: 'Technical', labelKey: 'technical' },
  { value: 'Friendly', labelKey: 'friendly' },
] as const;

/** Article-settings readability tiers (#313): value is the preset's
 * readability_grade_max; labels name the audience, not the number. */
export const readabilityTiers = [
  { value: '8', labelKey: 'generalPublic' },
  { value: '10', labelKey: 'professional' },
  { value: '12', labelKey: 'technical' },
] as const;

export const internalLinkCounts = ['0', '1', '2', '3'];

export const referralSources = [
  { value: 'LinkedIn', labelKey: 'linkedin' },
  { value: 'Friend', labelKey: 'friend' },
  { value: 'Twitter/X', labelKey: 'twitterX' },
  { value: 'Search', labelKey: 'search' },
  { value: 'Community', labelKey: 'community' },
  { value: 'Other', labelKey: 'other' },
] as const;

export const initialForm: OnboardingForm = {
  websiteUrl: '',
  businessName: '',
  language: '',
  country: '',
  businessDescription: '',
  targetAudience: [],
  competitors: [],
  sitemapUrl: '',
  blogPageUrl: '',
  blogPosts: ['', '', ''],
  articleStyle: '',
  includeCta: true,
  internalLinksCount: '1',
  tableOfContents: true,
  youtubeVideos: true,
  integrations: [],
  referralSource: '',
};

export const errorClass = 'mt-1 text-error text-sm';

export const blogPostFields = [
  { id: 'blogPost0', index: 0, labelKey: 'post1' },
  { id: 'blogPost1', index: 1, labelKey: 'post2' },
  { id: 'blogPost2', index: 2, labelKey: 'post3' },
] as const;
