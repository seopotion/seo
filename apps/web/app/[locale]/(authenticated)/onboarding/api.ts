import type { SetupPresets } from '@shared/schemas';
import type { SetupStatus } from '@shared/types';
import { api } from '@/lib/api';
import type { OnboardingForm } from './types';
import { isValidHttpUrl, stringsToTextEntries, textEntriesToStrings } from './utils';

const SCAN_POLL_INTERVAL_MS = 2000;
const SCAN_POLL_TIMEOUT_MS = 120_000;

type ApiFailureReason = 'unauthorized' | 'request_failed' | 'invalid_response' | 'timeout';

type JsonResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};

export class OnboardingApiError extends Error {
  reason: ApiFailureReason;

  constructor(reason: ApiFailureReason) {
    super(reason);
    this.name = 'OnboardingApiError';
    this.reason = reason;
  }
}

type SetupPresetsPatch = {
  business?: Partial<SetupPresets['business']>;
  audience?: Partial<SetupPresets['audience']>;
  blog?: Partial<SetupPresets['blog']>;
  article_preferences?: {
    content_seo?: Partial<SetupPresets['article_preferences']['content_seo']>;
    engagement?: Partial<SetupPresets['article_preferences']['engagement']>;
  };
};

type OnboardingFormPatch = Partial<
  Pick<
    OnboardingForm,
    | 'articleStyle'
    | 'blogPageUrl'
    | 'blogPosts'
    | 'businessDescription'
    | 'businessName'
    | 'competitors'
    | 'country'
    | 'internalLinksCount'
    | 'language'
    | 'sitemapUrl'
    | 'targetAudience'
  >
>;

type StartScanResponse = {
  org_id: string;
  setup_status: SetupStatus;
};

type StatusResponse = {
  setup_status: SetupStatus;
};

type DetailsResponse = {
  presets: SetupPresets;
};

export type OnboardingScanResult = {
  orgId: string;
  formPatch: OnboardingFormPatch;
};

async function readJson<T>(response: JsonResponse): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new OnboardingApiError('invalid_response');
  }
}

async function ensureOk<T = unknown>(response: JsonResponse): Promise<T> {
  if (response.status === 401) {
    throw new OnboardingApiError('unauthorized');
  }

  if (!response.ok) {
    throw new OnboardingApiError('request_failed');
  }

  return readJson(response);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCompetitor(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) return '';
  if (isValidHttpUrl(trimmedValue)) return trimmedValue;
  if (/^[^\s/]+\.[^\s/]+$/.test(trimmedValue)) return `https://${trimmedValue}`;

  return trimmedValue;
}

function toBlogPosts(values: string[]): [string, string, string] {
  const blogPosts = values.map((value) => value.trim()).filter(Boolean);

  return [blogPosts[0] ?? '', blogPosts[1] ?? '', blogPosts[2] ?? ''];
}

function mapPresetsToFormPatch(presets: SetupPresets): OnboardingFormPatch {
  return {
    articleStyle: presets.article_preferences.content_seo.article_style,
    blogPageUrl: presets.blog.main_blog_url,
    blogPosts: toBlogPosts(presets.blog.best_articles),
    businessDescription: presets.business.description,
    businessName: presets.business.name,
    competitors: stringsToTextEntries(
      presets.audience.competitors.map((competitor) => normalizeCompetitor(competitor)),
      'competitor',
    ),
    country: presets.business.country,
    internalLinksCount: String(presets.article_preferences.content_seo.internal_links_count),
    language: presets.business.language,
    sitemapUrl: presets.blog.sitemap_url,
    targetAudience: stringsToTextEntries(presets.audience.target, 'audience'),
  };
}

function buildPresetsPatch(form: OnboardingForm): SetupPresetsPatch {
  return {
    business: {
      name: form.businessName.trim(),
      language: form.language,
      country: form.country,
      description: form.businessDescription.trim(),
    },
    audience: {
      target: textEntriesToStrings(form.targetAudience),
      competitors: form.competitors.map((entry) => entry.value.trim()).filter(Boolean),
    },
    blog: {
      sitemap_url: form.sitemapUrl.trim(),
      main_blog_url: form.blogPageUrl.trim(),
      best_articles: form.blogPosts.map((url) => url.trim()).filter(Boolean),
    },
    article_preferences: {
      content_seo: {
        article_style: form.articleStyle,
        internal_links_count: Number.parseInt(form.internalLinksCount, 10),
      },
    },
  };
}

async function startSetupScan(websiteUrl: string) {
  const response = await api.api.v0.setup.start_scan.$post({
    json: { website_url: websiteUrl.trim() },
  });

  return ensureOk<StartScanResponse>(response);
}

async function getSetupStatus(orgId: string) {
  const response = await api.api.v0.setup.status.$get({ query: { org_id: orgId } });
  const data = await ensureOk<StatusResponse>(response);
  return data.setup_status;
}

async function waitForSetupScan(orgId: string) {
  const expiresAt = Date.now() + SCAN_POLL_TIMEOUT_MS;

  while (Date.now() <= expiresAt) {
    const setupStatus = await getSetupStatus(orgId);

    if (setupStatus === 'setup_scan_completed' || setupStatus === 'setup_complete') {
      return;
    }

    if (setupStatus === 'setup_not_started') {
      throw new OnboardingApiError('request_failed');
    }

    await delay(SCAN_POLL_INTERVAL_MS);
  }

  throw new OnboardingApiError('timeout');
}

async function getSetupDetails(orgId: string) {
  const response = await api.api.v0.setup.details.$get({ query: { org_id: orgId } });
  return ensureOk<DetailsResponse>(response);
}

async function saveOnboardingPresets(orgId: string, form: OnboardingForm) {
  const response = await api.api.v0.setup.presets.$patch({
    json: {
      org_id: orgId,
      presets: buildPresetsPatch(form),
    },
  });

  await ensureOk<DetailsResponse>(response);
}

export async function scanWebsiteForOnboarding(websiteUrl: string): Promise<OnboardingScanResult> {
  const scan = await startSetupScan(websiteUrl);

  await waitForSetupScan(scan.org_id);

  const details = await getSetupDetails(scan.org_id);

  return {
    orgId: scan.org_id,
    formPatch: mapPresetsToFormPatch(details.presets),
  };
}

export async function completeOnboarding(orgId: string, form: OnboardingForm): Promise<void> {
  await saveOnboardingPresets(orgId, form);

  const response = await api.api.v0.setup.finalize.$post({
    json: { org_id: orgId },
  });

  await ensureOk(response);
}
