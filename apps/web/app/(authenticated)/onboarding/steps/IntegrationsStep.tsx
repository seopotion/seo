import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui';
import { cn } from '../../../../lib/utils';
import { referralSources } from '../constants';
import type { OnboardingForm, UpdateOnboardingField } from '../types';

const integrations = [
  {
    id: 'wordpress',
    name: 'WordPress.com',
    icon: (
      <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M6.8 8.4h1.8l2.2 6.6 1.6-4.8-.6-1.8h1.8l2.1 6.4 1.8-6.4h1.7"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    ),
  },
  {
    id: 'framer',
    name: 'Framer',
    icon: (
      <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none">
        <path
          d="M7 4h10v5h-5l5 5H7V9h5L7 4Z"
          stroke="currentColor"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
        <path d="M7 14h5v6L7 14Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
      </svg>
    ),
  },
];

export function IntegrationsStep({
  form,
  toggleIntegration,
  updateField,
}: {
  form: OnboardingForm;
  toggleIntegration: (integrationId: string) => void;
  updateField: UpdateOnboardingField;
}) {
  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">Integrations And Referral Source</h2>

      <div className="mt-6">
        <p className="font-medium text-sm leading-none">Available integrations</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {integrations.map((integration) => {
            const selected = form.integrations.includes(integration.id);

            return (
              <Button
                key={integration.id}
                variant="outline"
                onClick={() => toggleIntegration(integration.id)}
                aria-pressed={selected}
                className={cn(
                  'h-auto justify-start gap-3 px-3 py-3 text-left',
                  selected
                    ? 'border-primary bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary'
                    : 'text-foreground',
                )}
              >
                <span className="flex size-9 items-center justify-center rounded-md border border-current">
                  {integration.icon}
                </span>
                <span className="font-semibold">{integration.name}</span>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="mt-6">
        <Label htmlFor="referralSource">How did you hear about us?</Label>
        <Select
          value={form.referralSource || undefined}
          onValueChange={(value) => updateField('referralSource', value)}
        >
          <SelectTrigger id="referralSource" className="mt-2">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent>
            {referralSources.map((source) => (
              <SelectItem key={source} value={source}>
                {source}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
