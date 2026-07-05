import type { SetupStatus } from '@shared/schemas';
import { Alert, AlertDescription, Button, Input, Label } from '../../../../components/ui';
import { ErrorMessage } from '../components/ErrorMessage';
import type { Errors, OnboardingForm, ScanState } from '../types';

export function WebsiteScanStep({
  errors,
  form,
  onScanWebsite,
  onWebsiteUrlChange,
  orgId,
  scanState,
  setupStatus,
}: {
  errors: Errors;
  form: OnboardingForm;
  onScanWebsite: () => void;
  onWebsiteUrlChange: (value: string) => void;
  orgId: string | null;
  scanState: ScanState;
  setupStatus: SetupStatus | null;
}) {
  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">Website Scan</h2>
      <p className="mt-2 text-gray-600 text-sm">Start with the site Seopotion should learn from.</p>

      <div className="mt-6">
        <Label htmlFor="websiteUrl">Website URL</Label>
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
          {scanState === 'scanning' ? 'Scanning...' : 'Scan website'}
        </Button>
        {scanState === 'complete' && (
          <Alert className="border-emerald-200 bg-emerald-50 py-2 text-emerald-900 sm:flex-1">
            <AlertDescription className="text-emerald-800">
              Scan complete. Generated setup details have been added to the next steps.
            </AlertDescription>
          </Alert>
        )}
        {scanState === 'scanning' && (
          <Alert className="py-2 sm:flex-1">
            <AlertDescription>Scanning website content. This can take a moment.</AlertDescription>
          </Alert>
        )}
      </div>
      {(orgId || setupStatus) && (
        <p className="mt-3 text-gray-500 text-xs">
          {orgId ? `Org ${orgId}` : 'Setup'} {setupStatus ? `- ${setupStatus}` : ''}
        </p>
      )}
      <ErrorMessage>{errors.scan}</ErrorMessage>
    </div>
  );
}
