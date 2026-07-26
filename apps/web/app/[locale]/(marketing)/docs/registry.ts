/**
 * The single source of truth for docs navigation: order and grouping.
 *
 * Everything structural reads from here — the sidebar, the index cards,
 * breadcrumbs, prev/next, `generateStaticParams` and `sitemap.ts`. Nothing
 * structural lives in MDX frontmatter, so nav order can never diverge between
 * locales. Adding a page means one entry here plus `content/docs/{en,tr}/<slug>.mdx`;
 * the parity test fails the build if either side is missing.
 *
 * Groups render in the order declared below, and pages within a group in the
 * order they appear in `DOCS`. Prev/next follows the flat `DOCS` order.
 */

export const DOC_GROUPS = ['getting-started', 'content', 'publishing'] as const;

export type DocGroup = (typeof DOC_GROUPS)[number];

export type DocEntry = {
  group: DocGroup;
  slug: string;
};

export const DOCS: readonly DocEntry[] = [
  { slug: 'quickstart', group: 'getting-started' },
  { slug: 'content-planner', group: 'content' },
  { slug: 'wordpress', group: 'publishing' },
];

export const DOC_SLUGS: readonly string[] = DOCS.map((doc) => doc.slug);

export function findDoc(slug: string): DocEntry | undefined {
  return DOCS.find((doc) => doc.slug === slug);
}

/** Registry-order neighbours, for the prev/next footer on a guide page. */
export function docNeighbours(slug: string): { next: DocEntry | null; previous: DocEntry | null } {
  const index = DOCS.findIndex((doc) => doc.slug === slug);

  return {
    previous: index > 0 ? (DOCS[index - 1] ?? null) : null,
    next: index >= 0 ? (DOCS[index + 1] ?? null) : null,
  };
}

/** Declared group order, each with its pages in registry order. Empty groups are dropped. */
export function groupedDocs(): { entries: DocEntry[]; group: DocGroup }[] {
  return DOC_GROUPS.map((group) => ({
    group,
    entries: DOCS.filter((doc) => doc.group === group),
  })).filter((section) => section.entries.length > 0);
}

export function docPath(slug: string): string {
  return `/docs/${slug}`;
}
