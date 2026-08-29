import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

// The authenticated tree is normally gated behind a session; the dev escape
// hatch lets the layout chain render so the test exercises the real nesting.
vi.stubEnv('NODE_ENV', 'development');
vi.stubEnv('NEXT_PUBLIC_DISABLE_AUTH_GUARD', 'true');

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/onboarding',
  Link: () => null,
}));

const { default: AuthenticatedLayout } = await import('../app/[locale]/(authenticated)/layout');
const { default: OnboardingLayout } = await import(
  '../app/[locale]/(authenticated)/onboarding/layout'
);
const { default: OnboardingPage } = await import('../app/[locale]/(authenticated)/onboarding/page');

describe('authenticated layout', () => {
  // Regression: the onboarding page calls useConnectedIntegrations (react-query),
  // but the QueryClientProvider used to be mounted only in the (product) layout,
  // so /onboarding threw "No QueryClient set" and took the tab down with it.
  test('supplies a QueryClient to the onboarding route', () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(
          AuthenticatedLayout,
          null,
          createElement(OnboardingLayout, null, createElement(OnboardingPage)),
        ),
      ),
    ).not.toThrow();
  });
});
