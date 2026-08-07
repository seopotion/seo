import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_NAMESPACES } from '../i18n/client-namespaces';

/**
 * The root layout ships only `CLIENT_NAMESPACES` to the browser — the rest of
 * the bundle stays on the server, which is most of the payload win. The list is
 * written by hand, and getting it wrong fails *silently*: the server renders
 * fine, and the browser throws `MISSING_MESSAGE` only once a user reaches the
 * component that needed the missing namespace.
 *
 * So: start from every `'use client'` file, follow its imports transitively —
 * everything reachable that way is client code too, directive or not — and check
 * the namespaces those files read against the list.
 */

const WEB_ROOT = join(import.meta.dirname, '..');
const SOURCE_ROOTS = ['app', 'components', 'lib'];
const RESOLVE_AS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

function walk(relative: string): string[] {
  const absolute = join(WEB_ROOT, relative);

  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return walk(join(relative, entry.name));
    return /\.tsx?$/.test(entry.name) ? [join(absolute, entry.name)] : [];
  });
}

function sourceFiles(): string[] {
  return SOURCE_ROOTS.flatMap((root) => walk(root));
}

function isClientEntry(source: string): boolean {
  return /^\s*(['"])use client\1/m.test(source.slice(0, 500));
}

/** Static `from '…'` and dynamic `import('…')` specifiers, in source order. */
function importSpecifiers(source: string): string[] {
  return [
    ...[...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)],
    ...[...source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)],
  ].map((match) => match[1] as string);
}

/** Resolves `@/…` and relative specifiers to a file on disk; bare imports → null. */
function resolveImport(specifier: string, importer: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(WEB_ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(importer), specifier)
      : null;

  if (base === null) return null;

  return (
    RESOLVE_AS.map((suffix) => `${base}${suffix}`).find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
}

/** `useTranslations('A.b')` → `A`. A non-literal argument yields `null`. */
function namespacesRead(source: string): (string | null)[] {
  return [...source.matchAll(/\buse(?:Translations)\s*\(([^)]*)\)/g)].map((match) => {
    const argument = (match[1] as string).trim();
    const literal = /^(['"])([\w.]+)\1$/.exec(argument);

    return literal ? ((literal[2] as string).split('.')[0] as string) : null;
  });
}

/** Every file reachable from a `'use client'` entry, including the entries. */
function clientModuleGraph(): Map<string, string> {
  const sources = new Map(sourceFiles().map((file) => [file, readFileSync(file, 'utf8')]));
  const reached = new Map<string, string>();
  const queue = [...sources].filter(([, source]) => isClientEntry(source)).map(([file]) => file);

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (reached.has(file)) continue;

    const source = sources.get(file) ?? readFileSync(file, 'utf8');
    reached.set(file, source);

    for (const specifier of importSpecifiers(source)) {
      const target = resolveImport(specifier, file);
      if (target !== null && !reached.has(target)) queue.push(target);
    }
  }

  return reached;
}

const clientFiles = clientModuleGraph();

describe('client namespace subset', () => {
  it('finds client components to check', () => {
    // Guards the walk itself: a broken resolver would make every case below pass.
    expect(clientFiles.size).toBeGreaterThan(20);
  });

  it('reads every namespace with a literal argument', () => {
    const dynamic = [...clientFiles]
      .filter(([, source]) => namespacesRead(source).includes(null))
      .map(([file]) => file.replace(`${WEB_ROOT}/`, ''));

    expect(
      dynamic,
      'useTranslations() needs a literal namespace so the subset can be verified statically',
    ).toEqual([]);
  });

  it('lists every namespace that client components read', () => {
    const missing = new Map<string, string[]>();

    for (const [file, source] of clientFiles) {
      for (const namespace of namespacesRead(source)) {
        if (namespace === null || (CLIENT_NAMESPACES as readonly string[]).includes(namespace)) {
          continue;
        }

        const readers = missing.get(namespace) ?? [];
        readers.push(file.replace(`${WEB_ROOT}/`, ''));
        missing.set(namespace, readers);
      }
    }

    expect(
      Object.fromEntries(missing),
      'these namespaces are read in the browser but never sent — add them to i18n/client-namespaces.ts',
    ).toEqual({});
  });

  it('has no namespace that no client component reads', () => {
    const read = new Set(
      [...clientFiles.values()]
        .flatMap((source) => namespacesRead(source))
        .filter((n) => n !== null),
    );

    expect(
      CLIENT_NAMESPACES.filter((namespace) => !read.has(namespace)),
      'these are serialized into every page payload but nothing in the browser reads them',
    ).toEqual([]);
  });
});
