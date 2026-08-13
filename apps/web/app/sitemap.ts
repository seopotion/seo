import type { MetadataRoute } from 'next';
import { routing } from '../i18n/routing';
import { languageAlternates, localizedUrl } from '../i18n/urls';
import { absoluteUrl } from '../lib/seo';
import { loadDocFrontmatter } from './[locale]/(marketing)/docs/content';
import { DOCS, docPath } from './[locale]/(marketing)/docs/registry';

const defaultLastModified = new Date('2026-07-01');
const englishOnlyPaths = new Set(['/terms', '/privacy', '/refunds']);
const publicPaths = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/pricing', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/refunds', changeFrequency: 'yearly', priority: 0.3 },
  { path: '/docs', changeFrequency: 'weekly', priority: 0.7 },
] as const;

type SitemapEntry = {
  changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'];
  /** Per-locale override; docs entries carry their own `updated` frontmatter. */
  lastModified?: Partial<Record<string, Date>>;
  path: string;
  priority: number;
};

/**
 * One guide per registry entry, with a real per-page `lastModified` read from
 * each locale's MDX frontmatter — a fixed date across a growing docs site is a
 * weak signal. `/docs` itself stays the hub at priority 0.7.
 */
async function docEntries(): Promise<SitemapEntry[]> {
  return Promise.all(
    DOCS.map(async (doc) => {
      const updated = await Promise.all(
        routing.locales.map(async (locale) => {
          const { updated } = await loadDocFrontmatter(locale, doc.slug);
          return [locale, new Date(updated)] as const;
        }),
      );

      return {
        path: docPath(doc.slug),
        changeFrequency: 'monthly' as const,
        priority: 0.6,
        lastModified: Object.fromEntries(updated),
      };
    }),
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: SitemapEntry[] = [...publicPaths, ...(await docEntries())];

  return entries.flatMap((entry) => {
    const locales = englishOnlyPaths.has(entry.path) ? [routing.defaultLocale] : routing.locales;

    return locales.map((locale) => ({
      url: localizedUrl(entry.path, locale),
      lastModified: entry.lastModified?.[locale] ?? defaultLastModified,
      changeFrequency: entry.changeFrequency,
      priority: entry.priority,
      ...(englishOnlyPaths.has(entry.path)
        ? {}
        : {
            alternates: {
              languages: Object.fromEntries(
                Object.entries(languageAlternates(entry.path)).map(([alternateLocale, path]) => [
                  alternateLocale,
                  absoluteUrl(path),
                ]),
              ),
            },
          }),
    }));
  });
}
