export const SITE_NAME = 'Seopotion';
export const SITE_URL = normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

export const DEFAULT_TITLE = 'Seopotion — SEO Content Planning, Writing & Publishing Software';
export const DEFAULT_DESCRIPTION =
  'Analyze your website, discover content opportunities, generate SEO-oriented articles, review and edit them, and publish directly to WordPress with Seopotion.';

export const SOCIAL_IMAGE = {
  url: '/android-chrome-192x192.png',
  width: 192,
  height: 192,
  alt: 'Seopotion logo',
};

export function absoluteUrl(path = '/') {
  return new URL(path, SITE_URL).toString();
}

function normalizeSiteUrl(value: string | undefined) {
  if (!value) return 'https://seopotion.co';

  try {
    return new URL(value).origin;
  } catch {
    return 'https://seopotion.co';
  }
}
