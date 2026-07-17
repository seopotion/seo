import { absoluteUrl } from '@/lib/seo';
import { type Locale, routing } from './routing';

export function localizedPath(path: string, locale: Locale) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  if (locale === routing.defaultLocale) {
    return normalizedPath;
  }

  if (normalizedPath === '/') {
    return `/${locale}`;
  }

  return `/${locale}${normalizedPath}`;
}

export function localizedUrl(path: string, locale: Locale) {
  return absoluteUrl(localizedPath(path, locale));
}

export function languageAlternates(path: string) {
  return Object.fromEntries(
    routing.locales.map((locale) => [locale, localizedPath(path, locale)]),
  ) as Record<Locale, string>;
}
