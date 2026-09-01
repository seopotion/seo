'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type * as React from 'react';
import { cn } from '../../lib/utils';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

/**
 * Full-screen below `sm`, a centred card above.
 *
 * `Content` is nested inside `Overlay` rather than sitting beside it, so the
 * overlay's grid does the centring. Radix supports either arrangement — the
 * overlay shards the content ref into its scroll lock — and nesting keeps the
 * layout identical to the hand-rolled `Modal` this replaces.
 */
function DialogContent({
  children,
  className,
  overlayClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** For dialogs that are a small centred card rather than a full-bleed panel. */
  overlayClassName?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(
          'fixed inset-0 z-50 grid place-items-stretch bg-foreground/40 sm:place-items-center sm:p-4',
          overlayClassName,
        )}
      >
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            'relative flex h-dvh w-full flex-col bg-card shadow-lg sm:h-[min(90dvh,760px)] sm:max-w-5xl sm:rounded-lg sm:border sm:border-border',
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Overlay>
    </DialogPrimitive.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-semibold text-lg text-foreground', className)}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogTitle };
