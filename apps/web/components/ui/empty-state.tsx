import type * as React from 'react';
import { cn } from '../../lib/utils';

function EmptyState({
  className,
  framed = false,
  ...props
}: React.ComponentProps<'div'> & { framed?: boolean }) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        'grid place-items-center bg-card px-4 py-12 text-center text-muted-foreground text-sm',
        framed && 'rounded-lg border',
        className,
      )}
      {...props}
    />
  );
}

export { EmptyState };
