import Image from 'next/image';
import { useTranslations } from 'next-intl';
import {
  Badge,
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
    name: 'WordPress.org',
    logoSrc: '/integrations/wordpress-org.svg',
    comingSoon: false,
  },
  {
    id: 'wordpress-com',
    name: 'WordPress.com',
    logoSrc: '/integrations/wordpress.svg',
    comingSoon: true,
  },
  {
    id: 'framer',
    name: 'Framer',
    logoSrc: '/integrations/framer.svg',
    comingSoon: true,
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
  const t = useTranslations('Onboarding.integrations');
  const optionsT = useTranslations('Onboarding.options');

  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">{t('title')}</h2>
      <p className="mt-2 text-gray-600 text-sm">{t('settingsNotice')}</p>

      <div className="mt-6">
        <p className="font-medium text-sm leading-none">{t('availableIntegrations')}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
                <span className="font-semibold">{integration.name}</span>
                {integration.comingSoon ? (
                  <Badge variant="secondary">{t('comingSoon')}</Badge>
                ) : null}
              </Button>
            );
          })}
        </div>
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
