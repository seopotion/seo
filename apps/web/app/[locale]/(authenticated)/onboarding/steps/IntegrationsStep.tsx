import { GitBranch } from 'lucide-react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { WordPressDialog } from '@/components/integrations/WordPressDialog';
import {
  Badge,
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusPanel,
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
    id: 'static-site',
    name: null,
    logoSrc: null,
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
] as const;

export function IntegrationsStep({
  connectedIntegrationIds,
  form,
  integrationsError,
  integrationsLoading,
  onUnauthorized,
  onRetryIntegrations,
  organizationId,
  updateField,
}: {
  connectedIntegrationIds: OnboardingForm['integrations'];
  form: OnboardingForm;
  integrationsError: boolean;
  integrationsLoading: boolean;
  onUnauthorized: () => void;
  onRetryIntegrations: () => void;
  organizationId: string | null;
  updateField: UpdateOnboardingField;
}) {
  const t = useTranslations('Onboarding.integrations');
  const optionsT = useTranslations('Onboarding.options');
  const [wordpressDialogOpen, setWordpressDialogOpen] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const wordpressConnected = connectedIntegrationIds.includes('wordpress');

  return (
    <div>
      <h2 className="font-bold text-2xl text-foreground">{t('title')}</h2>
      <p className="mt-2 text-muted-foreground text-sm">{t('optionalNotice')}</p>

      <div className="mt-6">
        <p className="font-medium text-sm leading-none">{t('availableIntegrations')}</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {integrationOptions.map((integration) => {
            const isWordPress = integration.id === 'wordpress';
            const isStaticSite = integration.id === 'static-site';
            const isConnected = isWordPress && wordpressConnected;
            const isLoading = isWordPress && integrationsLoading;

            if (isStaticSite) {
              return (
                <div
                  key={integration.id}
                  className="flex min-h-16 items-center gap-3 rounded-md border border-input bg-background px-3 py-3 text-left"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center">
                    <GitBranch aria-hidden className="size-5 text-foreground" />
                  </span>
                  <span className="grid min-w-0 gap-1">
                    <span className="font-semibold">{t('providers.staticSite')}</span>
                    <span className="text-muted-foreground text-xs">{t('customSiteNotice')}</span>
                  </span>
                  <Badge className="ml-auto shrink-0" variant="secondary">
                    {t('setupLater')}
                  </Badge>
                </div>
              );
            }

            return (
              <Button
                key={integration.id}
                variant="outline"
                type="button"
                disabled={
                  integration.comingSoon ||
                  !organizationId ||
                  (isWordPress && (integrationsLoading || integrationsError))
                }
                onClick={() => {
                  if (isWordPress) setWordpressDialogOpen(true);
                }}
                className={cn(
                  'h-auto min-h-16 justify-start gap-3 px-3 py-3 text-left',
                  isConnected
                    ? 'border-primary bg-primary/5 text-primary hover:bg-primary/10 hover:text-primary'
                    : 'text-foreground',
                )}
              >
                <span className="flex size-9 items-center justify-center">
                  <Image src={integration.logoSrc} alt="" width={20} height={20} aria-hidden />
                </span>
                <span className="font-semibold">{integration.name}</span>
                {integration.comingSoon ? (
                  <Badge className="ml-auto" variant="secondary">
                    {t('comingSoon')}
                  </Badge>
                ) : isLoading ? (
                  <span className="ml-auto text-muted-foreground text-xs">{t('loading')}</span>
                ) : (
                  <span className="ml-auto text-xs">{t(isConnected ? 'replace' : 'connect')}</span>
                )}
              </Button>
            );
          })}
        </div>
        {integrationsError ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <p className="text-error text-sm">{t('loadError')}</p>
            <Button onClick={onRetryIntegrations} size="sm" variant="outline">
              {t('retry')}
            </Button>
          </div>
        ) : null}
        {justConnected ? (
          <div className="mt-3">
            <StatusPanel tone="success">{t('connectedSuccess')}</StatusPanel>
          </div>
        ) : null}
        <p className="mt-2 text-muted-foreground text-sm">{t('settingsNotice')}</p>
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

      <WordPressDialog
        isConnected={wordpressConnected}
        onClose={() => setWordpressDialogOpen(false)}
        onConnected={() => {
          setJustConnected(true);
          setWordpressDialogOpen(false);
        }}
        onUnauthorized={onUnauthorized}
        open={wordpressDialogOpen}
        organizationId={organizationId}
        siteUrl={form.websiteUrl}
      />
    </div>
  );
}
