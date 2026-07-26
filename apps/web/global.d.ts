import type { routing } from './i18n/routing';
import type messages from './messages/en.json';

/**
 * Teaches TypeScript what our messages and locales actually are. Without this,
 * `t('typo.key')` and `locale = 'de'` both compile clean and fail at runtime —
 * next-intl's defaults are `string` for both. English is the reference bundle;
 * `tests/messages.test.ts` enforces that every other locale matches its shape,
 * so checking against `en` checks against all of them.
 */
declare module 'next-intl' {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
