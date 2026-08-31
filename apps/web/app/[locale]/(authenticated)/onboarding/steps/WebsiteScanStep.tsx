import { useTranslations } from 'next-intl';
import { Alert, AlertDescription, Button, Input, Label } from '@/components/ui';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Errors, OnboardingForm, ScanState } from '../types';

export function WebsiteScanStep({
  errors,
  form,
  onScanWebsite,
  onWebsiteUrlChange,
  scanState,
}: {
  errors: Errors;
  form: OnboardingForm;
  onScanWebsite: () => void;
  onWebsiteUrlChange: (value: string) => void;
  scanState: ScanState;
}) {
  const t = useTranslations('Onboarding.websiteScan');

  return (
    <div>
      <h2 className="font-bold text-2xl text-foreground">{t('title')}</h2>
      <p className="mt-2 text-muted-foreground text-sm">{t('description')}</p>

      <div className="mt-6">
        <Label htmlFor="websiteUrl">{t('websiteUrl')}</Label>
        <Input
          className="mt-2"
          id="websiteUrl"
          type="url"
          value={form.websiteUrl}
          onChange={(event) => onWebsiteUrlChange(event.target.value)}
          placeholder="https://example.com"
          aria-invalid={Boolean(errors.websiteUrl)}
        />
        <ErrorMessage>{errors.websiteUrl}</ErrorMessage>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button onClick={onScanWebsite} disabled={scanState === 'scanning'}>
          {scanState === 'scanning' ? t('scanningButton') : t('scanButton')}
        </Button>
        {scanState === 'complete' && (
          <Alert className="border-emerald-200 bg-emerald-50 py-2 text-emerald-900 sm:flex-1">
            <AlertDescription className="text-emerald-800">{t('completeMessage')}</AlertDescription>
          </Alert>
        )}
        {scanState === 'scanning' && (
          <Alert className="py-2 sm:flex-1">
            <AlertDescription>{t('scanningMessage')}</AlertDescription>
          </Alert>
        )}
      </div>
      <ErrorMessage>{errors.scan}</ErrorMessage>
    </div>
  );
}
