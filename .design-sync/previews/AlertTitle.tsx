import { Alert, AlertDescription, AlertTitle } from '@seopotion/web-ui';
import { Info } from 'lucide-react';

export const InAlert = () => (
  <Alert className="max-w-md">
    <Info />
    <AlertTitle>Keyword research complete</AlertTitle>
    <AlertDescription>318 keywords were found for acme.com and grouped into 12 topics.</AlertDescription>
  </Alert>
);
