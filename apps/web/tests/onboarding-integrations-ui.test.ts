import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { initialForm } from '../app/[locale]/(authenticated)/onboarding/constants';
import { IntegrationsStep } from '../app/[locale]/(authenticated)/onboarding/steps/IntegrationsStep';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

function renderIntegrationsStep({
  connectedIntegrationIds = [],
  integrationsError = false,
  integrationsLoading = false,
}: {
  connectedIntegrationIds?: ('wordpress' | 'wordpress-com' | 'framer' | 'static-site')[];
  integrationsError?: boolean;
  integrationsLoading?: boolean;
} = {}) {
  const queryClient = new QueryClient();

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(IntegrationsStep, {
        connectedIntegrationIds,
        form: { ...initialForm, websiteUrl: 'https://example.com' },
        integrationsError,
        integrationsLoading,
        onRetryIntegrations: vi.fn(),
        onUnauthorized: vi.fn(),
        organizationId: 'org-1',
        updateField: vi.fn(),
      }),
    ),
  );
}

describe('onboarding integrations UI', () => {
  test('keeps unavailable providers disabled and presents WordPress as an action', () => {
    const html = renderIntegrationsStep();

    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('WordPress.com');
    expect(html).toContain('Framer');
    expect(html).toContain('providers.staticSite');
    expect(html).toContain('customSiteNotice');
    expect(html).toContain('setupLater');
    expect(html).toContain('connect');
    expect(html).not.toContain('aria-pressed');
  });

  test('renders the connected action from verified provider data', () => {
    const html = renderIntegrationsStep({ connectedIntegrationIds: ['wordpress'] });

    expect(html).toContain('replace');
    expect(html).not.toContain('aria-pressed');
  });

  test('shows retry feedback and disables WordPress while loading fails', () => {
    const html = renderIntegrationsStep({ integrationsError: true });

    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('loadError');
    expect(html).toContain('retry');
  });
});
