import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { initialForm } from '../app/[locale]/(authenticated)/onboarding/constants';
import { ArticleSettingsStep } from '../app/[locale]/(authenticated)/onboarding/steps/ArticleSettingsStep';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('onboarding article settings UI', () => {
  test('renders the CTA preference from form state', () => {
    const html = renderToStaticMarkup(
      createElement(ArticleSettingsStep, {
        errors: {},
        form: { ...initialForm, includeCta: false },
        updateField: vi.fn(),
      }),
    );

    expect(html).toContain('includeCta');
    expect(html).toContain('aria-checked="false"');
  });
});
