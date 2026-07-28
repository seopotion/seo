/** What an absent optional field renders as, everywhere in the panel. */
export const EMPTY = '—';

/** Renders a possibly-absent (or blank) scalar without ever showing "undefined". */
export function orEmpty(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? EMPTY : String(value);
}

/**
 * API timestamps are ISO strings; operators read them in their own timezone.
 * Absent or unparseable values render as `EMPTY` instead of "Invalid Date".
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? EMPTY : date.toLocaleString();
}
