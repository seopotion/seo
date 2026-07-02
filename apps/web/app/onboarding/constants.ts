import type { OnboardingForm } from './types';

export const steps = [
  'Website Scan',
  'About Your Business',
  'Audience & Competitors',
  'Blog Info',
  'Article Settings',
  'Integrations',
] as const;

export const languages = ['English', 'Turkish', 'Spanish', 'German', 'French'];
export const countries = [
  'United States',
  'Turkey',
  'United Kingdom',
  'Canada',
  'Germany',
  'France',
];
export const articleStyles = ['Informative', 'Casual', 'Professional', 'Technical', 'Friendly'];
export const internalLinkCounts = ['0', '1', '2', '3'];
export const referralSources = ['LinkedIn', 'Friend', 'Twitter/X', 'Search', 'Community', 'Other'];

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
  internalLinksCount: '1',
  tableOfContents: true,
  youtubeVideos: true,
  integrations: [],
  referralSource: '',
};

export const errorClass = 'mt-1 text-red-600 text-sm';

export const blogPostFields = [
  { id: 'blogPost0', index: 0, label: 'Blog post 1 URL' },
  { id: 'blogPost1', index: 1, label: 'Blog post 2 URL' },
  { id: 'blogPost2', index: 2, label: 'Blog post 3 URL' },
];
