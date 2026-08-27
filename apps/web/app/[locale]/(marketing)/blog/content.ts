import type { ComponentType } from 'react';
import { BLOG_LOCALE, POST_SLUGS } from './registry';

/**
 * Required frontmatter on every blog MDX file. `remark-mdx-frontmatter` turns
 * the YAML block into this named export at compile time, exactly as it does for
 * docs. Which posts exist lives in `registry.ts` instead — see the note there.
 */
export type PostFrontmatter = {
  author: string;
  /** Optional in-page hero, served from `public/blog/`. Social cards are generated. */
  cover?: string;
  coverAlt?: string;
  /** ISO date (yyyy-mm-dd) the post was published; drives ordering and `sitemap.ts`. */
  date: string;
  description: string;
  title: string;
  /** ISO date (yyyy-mm-dd) of the last meaningful edit, if the post has been revised. */
  updated?: string;
};

export type PostModule = {
  default: ComponentType;
  frontmatter: PostFrontmatter;
};

export type PostSummary = {
  frontmatter: PostFrontmatter;
  slug: string;
};

/**
 * Resolve one post. The template literal makes the bundler build a context of
 * every matching MDX file, which is what lets `generateStaticParams` prerender
 * the set. MDX bodies are server components, so none of this reaches the client
 * bundle.
 */
export async function loadPost(slug: string): Promise<PostModule> {
  return (await import(`@/content/blog/${BLOG_LOCALE}/${slug}.mdx`)) as PostModule;
}

export async function loadPostFrontmatter(slug: string): Promise<PostFrontmatter> {
  const { frontmatter } = await loadPost(slug);
  return frontmatter;
}

/**
 * Frontmatter dates are bare `yyyy-mm-dd`, which `Date` reads as midnight UTC —
 * formatting in local time would print the previous day west of Greenwich, and
 * these pages are prerendered on a build machine whose timezone is not ours.
 */
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' });

export function formatPostDate(date: string): string {
  return DATE_FORMAT.format(new Date(date));
}

/** Every published post, newest first. ISO dates sort correctly as strings. */
export async function listPosts(): Promise<PostSummary[]> {
  const posts = await Promise.all(
    POST_SLUGS.map(async (slug) => ({ slug, frontmatter: await loadPostFrontmatter(slug) })),
  );

  return posts.sort((a, b) => b.frontmatter.date.localeCompare(a.frontmatter.date));
}

/** Chronological neighbours, for the pager at the end of a post. */
export async function postNeighbours(
  slug: string,
): Promise<{ newer: PostSummary | null; older: PostSummary | null }> {
  const posts = await listPosts();
  const index = posts.findIndex((post) => post.slug === slug);

  return {
    newer: index > 0 ? (posts[index - 1] ?? null) : null,
    older: index >= 0 ? (posts[index + 1] ?? null) : null,
  };
}
