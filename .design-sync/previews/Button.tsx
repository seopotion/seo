import { Button } from '@seopotion/web-ui';
import { Plus, RefreshCw, Trash2 } from 'lucide-react';

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>Generate article</Button>
    <Button variant="secondary">Save draft</Button>
    <Button variant="outline">Preview</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="destructive">Delete article</Button>
    <Button variant="link">View on site</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">Small</Button>
    <Button>Default</Button>
    <Button size="lg">Large</Button>
    <Button size="icon" aria-label="Add keyword">
      <Plus />
    </Button>
  </div>
);

export const WithIcons = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button>
      <Plus />
      Add keyword
    </Button>
    <Button variant="outline">
      <RefreshCw />
      Rescan site
    </Button>
    <Button variant="destructive" size="sm">
      <Trash2 />
      Remove
    </Button>
  </div>
);

export const Disabled = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button disabled>Generating…</Button>
    <Button variant="outline" disabled>
      Preview
    </Button>
    <Button variant="destructive" disabled>
      Delete
    </Button>
  </div>
);

export const AsLink = () => (
  <Button asChild variant="outline">
    <a href="#docs">Read the docs</a>
  </Button>
);
