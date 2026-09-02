import { Button, EmptyState } from '@seopotion/web-ui';
import { Archive, Search } from 'lucide-react';

export const Default = () => (
  <EmptyState className="max-w-lg">No articles have been generated yet.</EmptyState>
);

export const Framed = () => (
  <EmptyState framed className="max-w-lg">
    No keywords match “wordpress hosting”. Try a broader search.
  </EmptyState>
);

export const WithIconAndAction = () => (
  <EmptyState framed className="max-w-lg">
    <div className="grid max-w-sm justify-items-center text-center">
      <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Archive className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 font-semibold text-base text-foreground">No published articles yet</h2>
      <p className="mt-2 text-muted-foreground text-sm leading-6">
        Articles land here once your 30-day content plan starts generating. The first one is due
        tomorrow at 07:00 UTC.
      </p>
      <Button size="sm" className="mt-4">
        Generate the first article
      </Button>
    </div>
  </EmptyState>
);

export const NoResults = () => (
  <EmptyState className="max-w-lg">
    <div className="grid max-w-sm justify-items-center text-center">
      <span className="flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Search className="size-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 font-semibold text-base text-foreground">No keywords found</h2>
      <p className="mt-2 text-muted-foreground text-sm leading-6">
        Nothing in your research matches this filter. Clear it or run a new scan of the site.
      </p>
      <Button size="sm" variant="outline" className="mt-4">
        Clear filter
      </Button>
    </div>
  </EmptyState>
);
