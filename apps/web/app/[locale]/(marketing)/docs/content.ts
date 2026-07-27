import type { ComponentType } from 'react';
import type { Locale } from '@/i18n/routing';

/**
 * Required frontmatter on every docs MDX file. `remark-mdx-frontmatter` turns
 * the YAML block into this named export at compile time. Structure (group,
 * order) deliberately lives in `registry.ts` instead — see the note there.
 */
export type DocFrontmatter = {
  description: string;
  title: string;
  /** ISO date (yyyy-mm-dd); feeds the page footer and `sitemap.ts`. */
  updated: string;
};

export type DocModule = {
  default: ComponentType;
  frontmatter: DocFrontmatter;
};

/**
 * Resolve one guide. The template literal makes the bundler build a context of
 * every matching MDX file, which is what lets `generateStaticParams` prerender
 * locales × slugs. MDX bodies are server components, so none of this reaches
 * the client bundle.
 */
export async function loadDoc(locale: Locale, slug: string): Promise<DocModule> {
  return (await import(`@/content/docs/${locale}/${slug}.mdx`)) as DocModule;
}

export async function loadDocFrontmatter(locale: Locale, slug: string): Promise<DocFrontmatter> {
  const { frontmatter } = await loadDoc(locale, slug);
  return frontmatter;
}

/** Frontmatter for a list of slugs, in the order given. */
export function loadDocsFrontmatter(
  locale: Locale,
  slugs: readonly string[],
): Promise<DocFrontmatter[]> {
  return Promise.all(slugs.map((slug) => loadDocFrontmatter(locale, slug)));
}
