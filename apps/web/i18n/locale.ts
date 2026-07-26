import { notFound } from 'next/navigation';
import { hasLocale } from 'next-intl';
import { type Locale, routing } from './routing';

/**
 * Narrows a route's `params.locale` to `Locale`.
 *
 * Next 16's typed routes hand every segment a plain `string`, while
 * `AppConfig['Locale']` (see `global.d.ts`) is the `'en' | 'tr'` union — so the
 * two need bridging at every `setRequestLocale` / `getTranslations` call site.
 * Doing it by validation rather than a cast means a path the proxy let through
 * without messages behind it 404s instead of rendering half-translated.
 */
export function routeLocale(value: string): Locale {
  if (!hasLocale(routing.locales, value)) notFound();

  return value;
}
