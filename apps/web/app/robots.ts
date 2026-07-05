import type { MetadataRoute } from 'next';
import { absoluteUrl, SITE_URL } from '../lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
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
      ],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_URL,
  };
}
