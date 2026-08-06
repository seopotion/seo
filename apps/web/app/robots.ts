import type { MetadataRoute } from 'next';
import { routing } from '../i18n/routing';
import { localizedPath } from '../i18n/urls';
import { absoluteUrl, SITE_URL } from '../lib/seo';

const privatePaths = [
  '/dashboard',
  '/onboarding',
  '/home',
  '/content-planner',
  '/article-settings',
  '/article-improvements',
  '/backlinks',
  '/ads',
  '/analytics',
  '/settings',
];

export default function robots(): MetadataRoute.Robots {
  // Non-prod builds (staging) must never be indexed — the deploy workflow sets
  // NEXT_PUBLIC_NOINDEX=1 there. Metadata routes are prerendered, so this is
  // resolved at build time.
  if (process.env.NEXT_PUBLIC_NOINDEX === '1') {
    return {
      rules: { userAgent: '*', disallow: '/' },
      host: SITE_URL,
    };
  }

  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        ...privatePaths.flatMap((path) =>
          routing.locales.map((locale) => localizedPath(path, locale)),
        ),
      ],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  };
}
