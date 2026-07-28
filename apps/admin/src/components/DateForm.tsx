import { useState } from 'react';

/**
 * The inline `YYYY-MM-DD` picker behind schedule / reschedule. A native date
 * input on purpose — the panel takes no date-picker dependency, and the API
 * wants exactly this format.
 */
export function DateForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: string;
  submitLabel: string;
  onSubmit: (date: string) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(initial);

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (date) onSubmit(date);
      }}
    >
      <input
        type="date"
        required
        value={date}
        onChange={(event) => setDate(event.target.value)}
        className="rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
      />
      <button
        type="submit"
        className="rounded bg-neutral-100 px-2 py-1 text-xs font-semibold text-neutral-900 hover:bg-white"
      >
        {submitLabel}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
      >
        Cancel
      </button>
    </form>
  );
}
