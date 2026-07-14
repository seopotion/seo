import Image from 'next/image';
import { useTranslations } from 'next-intl';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import { referralSources } from '../constants';
import type { OnboardingForm, UpdateOnboardingField } from '../types';

export const integrationOptions = [
  {
    id: 'wordpress',
    labelKey: 'wordpress',
    logoSrc: '/integrations/wordpress.svg',
  },
  {
    id: 'framer',
    labelKey: 'framer',
    logoSrc: '/integrations/framer.svg',
  },
] as const;

export function IntegrationsStep({
  form,
  toggleIntegration,
  updateField,
}: {
  form: OnboardingForm;
  toggleIntegration: (integrationId: string) => void;
  updateField: UpdateOnboardingField;
}) {
  const t = useTranslations('Onboarding.integrations');
  const optionsT = useTranslations('Onboarding.options');

  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">{t('title')}</h2>

      <div className="mt-6">
        <p className="font-medium text-sm leading-none">{t('availableIntegrations')}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {integrationOptions.map((integration) => {
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
                <span className="flex size-9 items-center justify-center">
                  <Image src={integration.logoSrc} alt="" width={20} height={20} aria-hidden />
                </span>
                <span className="font-semibold">{t(`providers.${integration.labelKey}`)}</span>
              </Button>
            );
          })}
        </div>
        <p className="mt-2 text-gray-500 text-sm">{t('connectWordPressLater')}</p>
      </div>

      <div className="mt-6">
        <Label htmlFor="referralSource">{t('referralSource')}</Label>
        <Select
          value={form.referralSource || undefined}
          onValueChange={(value) => updateField('referralSource', value)}
        >
          <SelectTrigger id="referralSource" className="mt-2">
            <SelectValue placeholder={t('selectOption')} />
          </SelectTrigger>
          <SelectContent>
            {referralSources.map((source) => (
              <SelectItem key={source.value} value={source.value}>
                {optionsT(`referralSources.${source.labelKey}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
