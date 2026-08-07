import { useEffect } from 'react';

/**
 * The two-step confirm every mutating action goes through (design §5): the
 * button opens this, and only its confirm fires the mutation. The dialog states
 * exactly what will happen, and `customerVisible` calls out the effects the
 * customer can notice — operators should never have to guess.
 *
 * Deliberately plain: a fixed overlay and Tailwind, no dialog library.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  variant = 'default',
  customerVisible,
  warning,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  variant?: 'default' | 'danger';
  customerVisible?: string;
  /** A reason not to go through with this — louder than `customerVisible`. */
  warning?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded border border-neutral-700 bg-neutral-900 p-5 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-neutral-300">{body}</p>

        {warning && (
          <p className="mt-4 rounded border border-red-500 bg-red-950 p-3 text-sm font-semibold text-red-200">
            {warning}
          </p>
        )}

        {customerVisible && (
          <p className="mt-4 rounded border border-amber-600/60 bg-amber-950/60 p-3 text-sm text-amber-200">
            <span className="font-semibold">Customer-visible:</span> {customerVisible}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm hover:bg-neutral-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={
              variant === 'danger'
                ? 'rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500'
                : 'rounded bg-neutral-100 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-white'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
