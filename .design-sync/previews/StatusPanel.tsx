import { StatusPanel } from '@seopotion/web-ui';

export const Tones = () => (
  <div className="grid max-w-lg gap-3">
    <StatusPanel>Loading your organization…</StatusPanel>
    <StatusPanel tone="info">
      Google Search Console data refreshes once a day. Yesterday's clicks appear after 07:00 UTC.
    </StatusPanel>
    <StatusPanel tone="success">Settings saved.</StatusPanel>
    <StatusPanel tone="warning">
      Your WordPress connection needs to be re-authorized before the next article can publish.
    </StatusPanel>
    <StatusPanel tone="error">
      We couldn't load your organization. Refresh the page or contact support if this keeps
      happening.
    </StatusPanel>
  </div>
);

export const WithLink = () => (
  <StatusPanel tone="success" className="max-w-lg">
    Article published.{' '}
    <a href="#commit" className="font-medium underline underline-offset-4">
      View commit
    </a>
  </StatusPanel>
);

export const LongMessage = () => (
  <StatusPanel tone="info" className="max-w-lg">
    <p className="font-medium">Scan in progress</p>
    <p className="mt-1">
      We're reading your site's pages, competitors and search data to build a 30-day content
      plan. This usually takes two to three minutes; you can leave this page and come back.
    </p>
  </StatusPanel>
);
