import { Alert, AlertDescription, AlertTitle } from '@seopotion/web-ui';
import { AlertTriangle } from 'lucide-react';

export const InAlert = () => (
  <Alert variant="destructive" className="max-w-md">
    <AlertTriangle />
    <AlertTitle>Article generation failed</AlertTitle>
    <AlertDescription>
      “Best CRM tools for small agencies” could not be generated because the site scan has not
      finished. Retry once the scan completes.
    </AlertDescription>
  </Alert>
);
