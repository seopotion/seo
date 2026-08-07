import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared by the integrations panel and both of its provider dialogs. */
export function StatusPanel({
  children,
  tone,
}: {
  children: ReactNode;
  tone: 'error' | 'success';
}) {
  return (
    <div
      aria-live="polite"
      className={cn(
        'rounded-md border px-4 py-3 text-sm',
        tone === 'error' && 'border-red-200 bg-red-50 text-red-700',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
      )}
    >
      {children}
    </div>
  );
}
