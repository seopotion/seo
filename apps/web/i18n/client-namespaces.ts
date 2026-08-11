/**
 * Namespaces reachable from a `'use client'` component. Everything else —
 * metadata namespaces, the landing page, the navbar, docs chrome — renders on
 * the server, so serializing it into every page's payload buys nothing.
 *
 * Adding `useTranslations` to a client component means adding its namespace
 * here. Forgetting to is a *runtime* failure (`MISSING_MESSAGE`) that only
 * surfaces when a user reaches that component, so `tests/client-namespaces.test.ts`
 * walks the client module graph and fails the build instead.
 *
 * Lives outside `app/[locale]/layout.tsx` so the test can import it without
 * pulling `globals.css` and the next-intl server entrypoints into Vitest.
 */
export const CLIENT_NAMESPACES = [
  'ArticleDetailPage',
  'ArticleEditor',
  'ArticleSettingsPage',
  'AuthGuard',
  'BillingPage',
  'ContentHistoryPage',
  'ContentPlannerPage',
  'GithubCallback',
  'GoogleJoinButton',
  'GscCallback',
  'HomePage',
  'LocaleSwitcher',
  'Onboarding',
  'PricingPage',
  'ProductShell',
  'SettingsPage',
] as const;
