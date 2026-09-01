import type * as React from 'react';
import { cn } from '../../lib/utils';

function PageTitle({ className, ...props }: React.ComponentProps<'h1'>) {
  return (
    <h1
      data-slot="page-title"
      className={cn('font-semibold text-foreground text-lg', className)}
      {...props}
    />
  );
}

function PageDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="page-description"
      className={cn('mt-1 max-w-2xl text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}

export { PageDescription, PageTitle };
