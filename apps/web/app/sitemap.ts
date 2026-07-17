import type { MetadataRoute } from 'next';
import { routing } from '../i18n/routing';
import { languageAlternates, localizedUrl } from '../i18n/urls';
import { absoluteUrl } from '../lib/seo';

const lastModified = new Date('2026-07-01');
const publicPaths = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  return publicPaths.flatMap((entry) =>
    routing.locales.map((locale) => ({
      url: localizedUrl(entry.path, locale),
      lastModified,
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
      alternates: {
        languages: Object.fromEntries(
          Object.entries(languageAlternates(entry.path)).map(([alternateLocale, path]) => [
            alternateLocale,
            absoluteUrl(path),
          ]),
        ),
      },
    })),
  );
}
