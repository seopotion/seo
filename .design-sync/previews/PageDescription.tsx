import { PageDescription, PageTitle } from '@seopotion/web-ui';

export const Default = () => (
  <PageDescription>
    Articles are generated every morning at 07:00 UTC and published to blog.acme.com as drafts
    for you to review.
  </PageDescription>
);

export const PageHeader = () => (
  <div>
    <PageTitle>Integrations</PageTitle>
    <PageDescription>
      Connect WordPress or a static site to publish articles, and Google Search Console to see
      how they perform.
    </PageDescription>
  </div>
);
