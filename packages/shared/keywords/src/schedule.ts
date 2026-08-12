/** Date-only (yyyy-mm-dd) `offset` days after `start`, in UTC. */
function addDays(start: Date, offset: number): string {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Stamp input order onto consecutive UTC dates, capped at `days` items. */
export function stampScheduledDates<T>(
  items: readonly T[],
  startDate: Date,
  days = items.length,
): Array<{ item: T; scheduled_date: string }> {
  if (!Number.isInteger(days) || days < 0) {
    throw new Error('days must be a non-negative integer');
  }
  return items.slice(0, days).map((item, index) => ({
    item,
    scheduled_date: addDays(startDate, index),
  }));
}
