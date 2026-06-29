import { Button } from '../../../components/ui';
import { ErrorMessage } from '../components/ErrorMessage';
import { inputClass, labelClass } from '../constants';
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
  return (
    <div>
      <h2 className="font-bold text-2xl text-gray-900">Website Scan</h2>
      <p className="mt-2 text-gray-600 text-sm">Start with the site Rankpace should learn from.</p>

      <div className="mt-6">
        <label className={labelClass} htmlFor="websiteUrl">
          Website URL
        </label>
        <input
          id="websiteUrl"
          type="url"
          value={form.websiteUrl}
          onChange={(event) => onWebsiteUrlChange(event.target.value)}
          placeholder="https://example.com"
          className={inputClass}
          aria-invalid={Boolean(errors.websiteUrl)}
        />
        <ErrorMessage>{errors.websiteUrl}</ErrorMessage>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button onClick={onScanWebsite} disabled={scanState === 'scanning'}>
          {scanState === 'scanning' ? 'Scanning...' : 'Scan website'}
        </Button>
        {scanState === 'complete' && (
          <p className="font-medium text-green-700 text-sm">
            Scan complete. A draft business description is ready.
          </p>
        )}
        {scanState === 'scanning' && (
          <p className="text-gray-600 text-sm">Scanning website content...</p>
        )}
      </div>
      <ErrorMessage>{errors.scan}</ErrorMessage>
    </div>
  );
}
