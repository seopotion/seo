import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOG_LOCALE, POST_SLUGS } from '../app/[locale]/(marketing)/blog/registry';

/**
 * Structural guards for blog content, mirroring `docs-content.test.ts`.
 *
 * A post is two halves — an entry in `registry.ts` and an MDX file — and either
 * half alone ships a broken build: a registry entry with no file fails
 * `generateStaticParams`, a file with no entry is simply never routed. These
 * cases catch both.
 *
 * The SERP limits are checked here rather than left to review because they are
 * the two fields a reader sees before they see the page, and nothing else in
 * the pipeline measures them.
 */

const WEB_ROOT = join(import.meta.dirname, '..');
const CONTENT_ROOT = join(WEB_ROOT, 'content/blog', BLOG_LOCALE);
const PUBLIC_ROOT = join(WEB_ROOT, 'public');
const REQUIRED_FRONTMATTER = ['title', 'description', 'date', 'author'] as const;
const MAX_TITLE = 60;
const MAX_DESCRIPTION = 160;

function mdxFiles(): string[] {
  return readdirSync(CONTENT_ROOT)
    .filter((file) => file.endsWith('.mdx'))
    .sort();
}

/** Minimal YAML-block reader — frontmatter here is flat `key: value` only. */
function frontmatter(slug: string): Record<string, string> {
  const source = readFileSync(join(CONTENT_ROOT, `${slug}.mdx`), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source);

  if (!match?.[1]) return {};

  return Object.fromEntries(
    match[1]
      .split('\n')
      .map((line) => /^([A-Za-z_][\w-]*):\s*(.+)$/.exec(line.trim()))
      .filter((parsed) => parsed !== null)
      .map((parsed) => [parsed[1] as string, (parsed[2] as string).replace(/^['"]|['"]$/g, '')]),
  );
}

describe('blog content', () => {
  it('has exactly one file per registry slug', () => {
    const expected = [...POST_SLUGS].sort().map((slug) => `${slug}.mdx`);

    expect(mdxFiles(), 'content/blog does not match registry.ts').toEqual(expected);
  });

  it('has no duplicate slugs', () => {
    expect([...new Set(POST_SLUGS)]).toHaveLength(POST_SLUGS.length);
  });

  it('has all required frontmatter keys, non-empty', () => {
    for (const slug of POST_SLUGS) {
      const parsed = frontmatter(slug);

      for (const key of REQUIRED_FRONTMATTER) {
        expect(parsed[key]?.trim(), `${slug} is missing "${key}"`).toBeTruthy();
      }
    }
  });

  it('dates the posts with ISO days, and never updates one before it was published', () => {
    for (const slug of POST_SLUGS) {
      const { date, updated } = frontmatter(slug);

      expect(date, `${slug} has a non-ISO "date"`).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      if (updated !== undefined) {
        expect(updated, `${slug} has a non-ISO "updated"`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(updated >= (date as string), `${slug} is "updated" before it was published`).toBe(
          true,
        );
      }
    }
  });

  it('keeps titles and descriptions inside their SERP limits', () => {
    for (const slug of POST_SLUGS) {
      const { title, description } = frontmatter(slug);

      expect(
        (title as string).length,
        `${slug} title is over ${MAX_TITLE} chars`,
      ).toBeLessThanOrEqual(MAX_TITLE);
      expect(
        (description as string).length,
        `${slug} description is over ${MAX_DESCRIPTION} chars`,
      ).toBeLessThanOrEqual(MAX_DESCRIPTION);
    }
  });

  it('has the cover image every post that declares one points at', () => {
    for (const slug of POST_SLUGS) {
      const { cover } = frontmatter(slug);
      if (cover === undefined) continue;

      expect(cover.startsWith('/'), `${slug} cover must be a root-relative path`).toBe(true);
      expect(existsSync(join(PUBLIC_ROOT, cover)), `${slug} cover ${cover} does not exist`).toBe(
        true,
      );
    }
  });
});
