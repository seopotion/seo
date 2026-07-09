import { getToken } from '@/lib/auth';
import type { OnboardingForm, TextEntry } from './types';
import { createEntryId } from './utils';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787';
const SCAN_WEBSITE_PATH = '/api/v0/setup/scan_website';
const COMPLETE_ONBOARDING_PATH = '/api/v0/setup/complete';

type ApiFailureReason = 'unauthorized' | 'request_failed' | 'invalid_response';

export class OnboardingApiError extends Error {
  reason: ApiFailureReason;

  constructor(reason: ApiFailureReason) {
    super(reason);
    this.name = 'OnboardingApiError';
    this.reason = reason;
  }
}

export type WebsiteScrapeResult = {
  businessDescription: string;
  targetAudience: TextEntry[];
};

type RawWebsiteScrapeResponse = {
  business_description?: unknown;
  businessDescription?: unknown;
  target_audience?: unknown;
  targetAudience?: unknown;
};

function apiUrl(path: string) {
  return `${API_BASE_URL.replace(/\/$/, '')}${path}`;
}

function jsonHeaders() {
  const token = getToken();

  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new OnboardingApiError('invalid_response');
  }
}

function readString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function toTextEntries(values: string[]) {
  return values.map((value) => ({ id: createEntryId('audience'), value }));
}

function buildCompleteOnboardingBody(form: OnboardingForm) {
  return {
    website_url: form.websiteUrl.trim(),
    business: {
      name: form.businessName.trim(),
      language: form.language,
      country: form.country,
      description: form.businessDescription.trim(),
    },
    audience: {
      target_audience: form.targetAudience.map((entry) => entry.value.trim()).filter(Boolean),
      competitors: form.competitors.map((entry) => entry.value.trim()).filter(Boolean),
    },
    blog: {
      sitemap_url: form.sitemapUrl.trim(),
      main_blog_url: form.blogPageUrl.trim(),
      best_articles: form.blogPosts.map((url) => url.trim()).filter(Boolean),
    },
    article_preferences: {
      article_style: form.articleStyle,
      internal_links_count: Number.parseInt(form.internalLinksCount, 10),
      table_of_contents: form.tableOfContents,
      youtube_videos: form.youtubeVideos,
    },
    integrations: form.integrations,
    referral_source: form.referralSource,
  };
}

export async function scanWebsiteForOnboarding(websiteUrl: string): Promise<WebsiteScrapeResult> {
  const response = await fetch(apiUrl(SCAN_WEBSITE_PATH), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ website_url: websiteUrl.trim() }),
  });

  if (response.status === 401) {
    throw new OnboardingApiError('unauthorized');
  }

  if (!response.ok) {
    throw new OnboardingApiError('request_failed');
  }

  const data = (await parseJson(response)) as RawWebsiteScrapeResponse;
  const businessDescription = readString(
    data.business_description ?? data.businessDescription,
  ).trim();
  const targetAudience = readStringArray(data.target_audience ?? data.targetAudience);

  return {
    businessDescription,
    targetAudience: toTextEntries(targetAudience),
  };
}

export async function completeOnboarding(form: OnboardingForm): Promise<void> {
  const response = await fetch(apiUrl(COMPLETE_ONBOARDING_PATH), {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(buildCompleteOnboardingBody(form)),
  });

  if (response.status === 401) {
    throw new OnboardingApiError('unauthorized');
  }

  if (!response.ok) {
    throw new OnboardingApiError('request_failed');
  }
}
