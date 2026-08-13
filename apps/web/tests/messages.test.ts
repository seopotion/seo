import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { routing } from '../i18n/routing';

/**
 * Structural parity for the message bundles. next-intl resolves keys at runtime,
 * so a key that exists in `en` but not `tr` throws `MISSING_MESSAGE` in front of
 * a user rather than failing a build. These cases move that discovery into CI.
 *
 * `global.d.ts` covers the other half — it types `t()` against `en.json`, so a
 * typo'd key is a compile error. Together: English is checked by the compiler,
 * every other locale is checked here.
 */

const WEB_ROOT = join(import.meta.dirname, '..');
const MESSAGES_ROOT = join(WEB_ROOT, 'messages');
const SOURCE_ROOTS = ['app', 'components', 'lib'];
const REFERENCE_LOCALE = routing.defaultLocale;

/**
 * Values that are legitimately identical across locales: proper nouns, brand
 * names, symbols, and pure-placeholder strings. Anything *not* listed here that
 * matches English is an untranslated string.
 */
const SAME_IN_EVERY_LOCALE = new Set([
  'ArticleDetailPage.labels.slug',
  'ArticleDetailPage.publishing.providers.wordpress',
  'ArticleEditor.fields.slug',
  'BillingPage.tiers.expert.name',
  'BillingPage.tiers.paid.name',
  'ContentPlannerPage.researchKeywords.form.characterCount',
  'ContentPlannerPage.targetKeywords.notAvailable',
  'Onboarding.integrations.providers.framer',
  'Onboarding.options.referralSources.linkedin',
  'Onboarding.options.referralSources.twitterX',
  // Internal status line; "Org" is used as-is in the Turkish product copy too.
  'Onboarding.websiteScan.orgStatus',
  'PricingPage.tiers.expertledgrowth.name',
  'PricingPage.tiers.growth.name',
  'SettingsPage.googleSearchConsole.title',
  'SettingsPage.tabs.googleSearchConsole',
  'SettingsPage.wordpress.providers.framer',
  'SettingsPage.wordpress.providers.wordpressCom',
]);

/** Keys that are deliberately blank — an empty `placeholder` renders no hint. */
const ALLOWED_EMPTY = new Set(['Onboarding.audience.targetAudiencePlaceholder']);

type Messages = Record<string, unknown>;

function loadMessages(locale: string): Messages {
  return JSON.parse(readFileSync(join(MESSAGES_ROOT, `${locale}.json`), 'utf8')) as Messages;
}

/** `{ a: { b: 'x' } }` → `{ 'a.b': 'x' }`. Arrays are leaves (e.g. `keywords`). */
function flatten(value: Messages, prefix = ''): Record<string, string | string[]> {
  return Object.entries(value).reduce<Record<string, string | string[]>>((flat, [key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;

    if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
      return Object.assign(flat, flatten(child as Messages, path));
    }

    flat[path] = child as string | string[];
    return flat;
  }, {});
}

/**
 * ICU argument names in a message: `{count}` and `{count, plural, …}` both yield
 * `count`. A locale that drops one silently renders nothing where the value
 * should be, so the sets have to match exactly.
 */
function placeholders(message: string): string[] {
  return [...message.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)]
    .map((match) => match[1] as string)
    .sort();
}

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

const bundles = new Map(routing.locales.map((locale) => [locale, flatten(loadMessages(locale))]));
const reference = bundles.get(REFERENCE_LOCALE) as Record<string, string | string[]>;
const otherLocales = routing.locales.filter((locale) => locale !== REFERENCE_LOCALE);

describe('message bundle parity', () => {
  it('has the same key set in every locale', () => {
    const expected = Object.keys(reference).sort();

    for (const locale of otherLocales) {
      const actual = Object.keys(bundles.get(locale) ?? {}).sort();

      expect(
        actual.filter((key) => !expected.includes(key)),
        `${locale}.json has keys ${REFERENCE_LOCALE}.json does not`,
      ).toEqual([]);
      expect(
        expected.filter((key) => !actual.includes(key)),
        `${locale}.json is missing keys from ${REFERENCE_LOCALE}.json`,
      ).toEqual([]);
    }
  });

  it('has the same value shape for every key', () => {
    for (const locale of otherLocales) {
      for (const [key, value] of Object.entries(bundles.get(locale) ?? {})) {
        expect(
          Array.isArray(value),
          `${locale}.json "${key}" is not the same type as ${REFERENCE_LOCALE}`,
        ).toBe(Array.isArray(reference[key]));
      }
    }
  });

  it('has no empty values', () => {
    for (const locale of routing.locales) {
      for (const [key, value] of Object.entries(bundles.get(locale) ?? {})) {
        if (ALLOWED_EMPTY.has(key)) continue;

        const filled = Array.isArray(value) ? value.length > 0 : value.trim().length > 0;
        expect(filled, `${locale}.json "${key}" is empty`).toBe(true);
      }
    }
  });

  it('uses the same ICU placeholders in every locale', () => {
    for (const locale of otherLocales) {
      for (const [key, value] of Object.entries(bundles.get(locale) ?? {})) {
        const expected = reference[key];
        if (typeof value !== 'string' || typeof expected !== 'string') continue;

        expect(
          placeholders(value),
          `${locale}.json "${key}" does not use the same placeholders as ${REFERENCE_LOCALE}`,
        ).toEqual(placeholders(expected));
      }
    }
  });

  it('has no untranslated values outside the allowlist', () => {
    for (const locale of otherLocales) {
      const untranslated = Object.entries(bundles.get(locale) ?? {})
        .filter(([key, value]) => {
          if (SAME_IN_EVERY_LOCALE.has(key) || ALLOWED_EMPTY.has(key)) return false;
          return typeof value === 'string' && value.trim() !== '' && value === reference[key];
        })
        .map(([key, value]) => `${key} = ${JSON.stringify(value)}`);

      expect(
        untranslated,
        `${locale}.json copies ${REFERENCE_LOCALE} verbatim — translate these, or allowlist them if they are proper nouns`,
      ).toEqual([]);
    }
  });

  it('has no namespace the app never reads', () => {
    const sources = sourceFiles()
      .map((file) => readFileSync(file, 'utf8'))
      .join('\n');

    const unused = Object.keys(loadMessages(REFERENCE_LOCALE)).filter(
      (namespace) => !sources.includes(`'${namespace}'`),
    );

    expect(unused, 'these namespaces are dead weight in every payload — delete them').toEqual([]);
  });
});
