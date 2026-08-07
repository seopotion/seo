import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC_SLUGS } from '../app/[locale]/(marketing)/docs/registry';
import { routing } from '../i18n/routing';

/**
 * Structural parity for docs content. next-intl used to give this for free when
 * prose lived in the message bundle; with per-locale MDX files nothing enforces
 * it, so a missing Turkish page would ship a 404 to half the audience. These
 * cases fail the build instead — there is deliberately no English fallback.
 */

const WEB_ROOT = join(import.meta.dirname, '..');
const CONTENT_ROOT = join(WEB_ROOT, 'content/docs');
const SCREENSHOT_ROOT = join(WEB_ROOT, 'public/docs');
const REQUIRED_FRONTMATTER = ['title', 'description', 'updated'] as const;

function mdxFiles(locale: string): string[] {
  return readdirSync(join(CONTENT_ROOT, locale))
    .filter((file) => file.endsWith('.mdx'))
    .sort();
}

/** Minimal YAML-block reader — frontmatter here is flat `key: value` only. */
function frontmatter(locale: string, file: string): Record<string, string> {
  const source = readFileSync(join(CONTENT_ROOT, locale, file), 'utf8');
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

function pngFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  return entries.flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return pngFiles(path);
    return path.endsWith('.png') ? [path] : [];
  });
}

describe('docs content parity', () => {
  it('has the same file set in every locale', () => {
    const [first, ...rest] = routing.locales;
    const expected = mdxFiles(first);

    for (const locale of rest) {
      expect(mdxFiles(locale), `${locale} does not match ${first}`).toEqual(expected);
    }
  });

  it('has exactly one file per registry slug, in every locale', () => {
    const expected = [...DOC_SLUGS].sort().map((slug) => `${slug}.mdx`);

    for (const locale of routing.locales) {
      expect(mdxFiles(locale), `${locale} does not match registry.ts`).toEqual(expected);
    }
  });

  it('has all required frontmatter keys, non-empty', () => {
    for (const locale of routing.locales) {
      for (const file of mdxFiles(locale)) {
        const parsed = frontmatter(locale, file);

        for (const key of REQUIRED_FRONTMATTER) {
          expect(parsed[key]?.trim(), `${locale}/${file} is missing "${key}"`).toBeTruthy();
        }

        expect(parsed.updated, `${locale}/${file} has a non-ISO "updated"`).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        );
      }
    }
  });

  it('has a per-locale pair for every screenshot', () => {
    const screenshots = pngFiles(SCREENSHOT_ROOT);
    const localePattern = new RegExp(`\\.(${routing.locales.join('|')})\\.png$`);

    for (const path of screenshots) {
      expect(path, 'screenshots must be named <name>.<locale>.png').toMatch(localePattern);
    }

    for (const path of screenshots) {
      const base = path.replace(localePattern, '');

      for (const locale of routing.locales) {
        expect(screenshots, `${base} is missing its ${locale} screenshot`).toContain(
          `${base}.${locale}.png`,
        );
      }
    }
  });
});
