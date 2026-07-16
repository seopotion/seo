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
