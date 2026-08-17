import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import GithubSlugger from 'github-slugger';
import { BLOG_LOCALE } from './registry';

/**
 * Reading time and the heading outline both need a post's *source*, which the
 * compiled MDX module no longer carries — `import`ing it yields a component and
 * its frontmatter, not the markdown.
 *
 * Reading it off disk is safe here because every blog route is prerendered
 * (`dynamicParams = false` + `generateStaticParams`), so this runs during
 * `next build` with the repo present and never on a request. `process.cwd()` is
 * `apps/web` for both `next build` and `next dev`.
 */

const WORDS_PER_MINUTE = 200;

export type Heading = {
  depth: 2 | 3;
  id: string;
  text: string;
};

export type PostSource = {
  headings: Heading[];
  readingMinutes: number;
};

/** Prose only — frontmatter and fenced code are neither read nor outlined. */
function readBody(slug: string): string {
  const path = join(process.cwd(), 'content/blog', BLOG_LOCALE, `${slug}.mdx`);

  return readFileSync(path, 'utf8')
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, '')
    .replace(/```[\s\S]*?```/g, '');
}

export function readPostSource(slug: string): PostSource {
  const body = readBody(slug);

  // `github-slugger` is the same library `rehype-slug` uses on the rendered
  // page, including its duplicate-heading counter — so these ids always match
  // the anchors the browser has to jump to.
  const slugger = new GithubSlugger();
  const headings = [...body.matchAll(/^(#{2,3})\s+(.+)$/gm)].map<Heading>((match) => {
    const text = (match[2] as string).replace(/[*_`]/g, '').trim();

    return { depth: (match[1] as string).length as 2 | 3, id: slugger.slug(text), text };
  });

  const words = body.split(/\s+/).filter(Boolean).length;

  return { headings, readingMinutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)) };
}
