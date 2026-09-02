import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';
import { cn } from '../../lib/utils';

/**
 * A soft status surface: pale fill, tinted edge, readable text. Pick the tone by
 * what the message *is*, not by the colour you want.
 *
 * Distinct from the `destructive` Button/Badge variant, which is a *solid* fill
 * carrying white text. Announcement defaults (`aria-live`, `role`) suit the
 * common case and can be overridden per call site.
 */
const statusPanelVariants = cva('rounded-md border px-4 py-3 text-sm', {
  defaultVariants: {
    tone: 'neutral',
  },
  variants: {
    tone: {
      error: 'border-error-border bg-error-subtle text-error',
      info: 'border-info-border bg-info-subtle text-info',
      neutral: 'border-border bg-card text-muted-foreground',
      success: 'border-success-border bg-success-subtle text-success',
      warning: 'border-warning-border bg-warning-subtle text-warning',
    },
  },
});

function StatusPanel({
  className,
  tone,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof statusPanelVariants>) {
  return (
    <div
      data-slot="status-panel"
      aria-live="polite"
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(statusPanelVariants({ tone }), className)}
      {...props}
    />
  );
}

export { StatusPanel, statusPanelVariants };
