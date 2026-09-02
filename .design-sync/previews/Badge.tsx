import { Badge } from '@seopotion/web-ui';
import { CheckCircle2, Clock } from 'lucide-react';

export const Default = () => <Badge>Published</Badge>;

export const Variants = () => (
  <div className="flex max-w-lg flex-wrap items-center gap-2">
    <Badge>Default</Badge>
    <Badge variant="secondary">Secondary</Badge>
    <Badge variant="outline">Outline</Badge>
    <Badge variant="neutral">Neutral</Badge>
    <Badge variant="destructive">Destructive</Badge>
  </div>
);

export const StatusTints = () => (
  <div className="flex max-w-lg flex-wrap items-center gap-2">
    <Badge variant="success">Published</Badge>
    <Badge variant="progress">Generating</Badge>
    <Badge variant="info">Scheduled</Badge>
    <Badge variant="warning">Needs review</Badge>
    <Badge variant="error">Failed</Badge>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge variant="success">
      <CheckCircle2 />
      Live on blog.acme.com
    </Badge>
    <Badge variant="neutral">
      <Clock />
      Draft
    </Badge>
  </div>
);

export const InContext = () => (
  <div className="flex max-w-md items-center justify-between gap-3 rounded-lg border p-3 text-sm">
    <div className="min-w-0">
      <p className="truncate font-medium">How to migrate a WordPress blog to a static site</p>
      <p className="text-muted-foreground text-xs">Scheduled for 14 Sep · 1,200 words</p>
    </div>
    <Badge variant="info">Scheduled</Badge>
  </div>
);
