import { Button, PageDescription, PageTitle } from '@seopotion/web-ui';
import { Plus } from 'lucide-react';

export const Default = () => <PageTitle>Content planner</PageTitle>;

export const PageHeader = () => (
  <div className="flex max-w-2xl items-start justify-between gap-6">
    <div>
      <PageTitle>Content planner</PageTitle>
      <PageDescription>
        Your next 30 days of articles, one per day. Reorder, swap keywords, or generate an article
        ahead of schedule.
      </PageDescription>
    </div>
    <Button size="sm">
      <Plus />
      Add keyword
    </Button>
  </div>
);
