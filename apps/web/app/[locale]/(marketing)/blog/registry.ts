/**
 * The single source of truth for which posts are published.
 *
 * Everything structural reads from here — the index, `generateStaticParams`,
 * the OG image route, `sitemap.ts` and the parity test — so publishing is one
 * line here plus `content/blog/en/<slug>.mdx`. The test fails the build if
 * either side is missing.
 *
 * Order in `POST_SLUGS` is deliberately meaningless: the index and the pager
 * both sort on each post's `date` frontmatter, which is the only ordering a
 * blog really has. Contrast `docs/registry.ts`, where the array order *is* the
 * navigation order.
 *
 * The blog ships English-only for now, the same way `/terms` and `/privacy`
 * do — so it stays out of `languageAlternates` and `/tr/blog` is not built.
 * Content still lives under a locale directory, so adding Turkish later is a
 * directory plus a locale field here rather than a restructure.
 */

import type { Locale } from '@/i18n/routing';

export const BLOG_LOCALE: Locale = 'en';

export const POST_SLUGS: readonly string[] = [
  'ai-seo-vs-freelancer-vs-agency',
  'does-google-penalize-ai-content',
  'ai-seo-software-vs-chatgpt',
];

export function isPostSlug(slug: string): boolean {
  return POST_SLUGS.includes(slug);
}

export function blogPath(slug: string): string {
  return `/blog/${slug}`;
}
