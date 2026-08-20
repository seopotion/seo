import type { ConnectedIntegration } from '@/lib/integrations';
import type { OnboardingForm } from './types';

export function clearOnboardingIntegrations(form: OnboardingForm): OnboardingForm {
  if (form.integrations.length === 0) return form;

  return { ...form, integrations: [] };
}

export function toOnboardingIntegrationIds(
  integrations: ConnectedIntegration[],
): OnboardingForm['integrations'] {
  return [...new Set(integrations.map((integration) => integration.provider))];
}
