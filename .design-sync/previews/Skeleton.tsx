import { Skeleton } from '@seopotion/web-ui';

export const Default = () => <Skeleton className="h-4 w-64" />;

export const ArticleRow = () => (
  <div className="grid max-w-md gap-3">
    <div className="flex items-center gap-4">
      <Skeleton className="size-12 shrink-0 rounded-md" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
    <div className="flex items-center gap-4">
      <Skeleton className="size-12 shrink-0 rounded-md" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
    <div className="flex items-center gap-4">
      <Skeleton className="size-12 shrink-0 rounded-md" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-5 w-16 rounded-full" />
    </div>
  </div>
);

export const StatCards = () => (
  <div className="grid max-w-2xl grid-cols-3 gap-4">
    <div className="grid gap-3 rounded-xl border p-6">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-7 w-12" />
    </div>
    <div className="grid gap-3 rounded-xl border p-6">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="h-7 w-14" />
    </div>
    <div className="grid gap-3 rounded-xl border p-6">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-7 w-16" />
    </div>
  </div>
);

export const ArticleCard = () => (
  <div className="grid max-w-md gap-4 rounded-xl border p-6">
    <Skeleton className="aspect-video w-full rounded-lg" />
    <div className="grid gap-2">
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
    <div className="flex items-center gap-2">
      <Skeleton className="h-8 w-28 rounded-md" />
      <Skeleton className="h-8 w-20 rounded-md" />
    </div>
  </div>
);
