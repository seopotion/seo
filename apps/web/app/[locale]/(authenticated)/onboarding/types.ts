import type { ONBOARDING_INTEGRATIONS } from '@shared/schemas';

export type ScanState = 'idle' | 'scanning' | 'complete';

export type TextEntry = {
  id: string;
  value: string;
};

export type OnboardingForm = {
  websiteUrl: string;
  businessName: string;
  language: string;
  country: string;
  businessDescription: string;
  targetAudience: TextEntry[];
  competitors: TextEntry[];
  sitemapUrl: string;
  blogPageUrl: string;
  blogPosts: string[];
  articleStyle: string;
  internalLinksCount: string;
  tableOfContents: boolean;
  youtubeVideos: boolean;
  integrations: (typeof ONBOARDING_INTEGRATIONS)[number][];
  referralSource: string;
};

export type Errors = Record<string, string>;

export type UpdateOnboardingField = <Field extends keyof OnboardingForm>(
  field: Field,
  value: OnboardingForm[Field],
  errorKeys?: string[],
) => void;
