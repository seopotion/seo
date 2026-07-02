export const SITE_NAME = 'Seopotion';
export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

export const DEFAULT_TITLE = 'Seopotion | AI SEO Content for Google and ChatGPT';
export const DEFAULT_DESCRIPTION =
  'Seopotion helps teams rank on Google and get mentioned by AI search with keyword research, on-brand SEO content, CMS publishing, and continuous tuning.';

export const SOCIAL_IMAGE = {
  url: '/hero-image-2.png',
  width: 1754,
  height: 1255,
  alt: 'Seopotion SEO growth dashboard preview',
};

export function absoluteUrl(path = '/') {
  return new URL(path, SITE_URL).toString();
}

function normalizeSiteUrl(value: string | undefined) {
  if (!value) return 'https://seopotion.com';

  try {
    return new URL(value).origin;
  } catch {
    return 'https://seopotion.com';
  }
}
