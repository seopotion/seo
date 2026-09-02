import { Alert, AlertDescription, AlertTitle } from '@seopotion/web-ui';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export const Default = () => (
  <Alert className="max-w-md">
    <Info />
    <AlertTitle>Site scan in progress</AlertTitle>
    <AlertDescription>
      We are crawling acme.com to find your existing pages. This usually takes two to three
      minutes.
    </AlertDescription>
  </Alert>
);

export const Destructive = () => (
  <Alert variant="destructive" className="max-w-md">
    <AlertTriangle />
    <AlertTitle>Publishing to WordPress failed</AlertTitle>
    <AlertDescription>
      blog.acme.com rejected the application password. Reconnect the site and try publishing
      again.
    </AlertDescription>
  </Alert>
);

export const WithoutIcon = () => (
  <Alert className="max-w-md">
    <AlertTitle>Content plan ready</AlertTitle>
    <AlertDescription>
      30 articles are scheduled. The first one generates tomorrow at 07:00 UTC.
    </AlertDescription>
  </Alert>
);

export const TitleOnly = () => (
  <Alert className="max-w-md">
    <CheckCircle2 />
    <AlertTitle>Google Search Console connected</AlertTitle>
  </Alert>
);
