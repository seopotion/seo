/** Date-only (yyyy-mm-dd) `offset` days after `start`, in UTC. */
function addDays(start: Date, offset: number): string {
  const d = new Date(start);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/**
 * Order `items` so same-`article_type` clusters are spread apart, then stamp a
 * consecutive `scheduled_date` on each (day 0..n-1 from `startDate`). Groups are
 * drained round-robin (largest first, stable) so adjacent days differ whenever
 * more than one group still has items. Deterministic. Caps at `days` items.
 */
export function clusterSpreadSchedule<T extends { article_type: string | null }>(
  items: T[],
  startDate: Date,
  days = 30,
): Array<T & { scheduled_date: string }> {
  const capped = items.slice(0, days);

  // Group by article_type (null -> 'other'), preserving input order within a group.
  const groups = new Map<string, T[]>();
  for (const it of capped) {
    const key = it.article_type ?? 'other';
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
  }

  // Round-robin drain: each pass, take one from every non-empty group, largest
  // remaining first (stable by group key) so big clusters don't bunch at the end.
  const ordered: T[] = [];
  while (ordered.length < capped.length) {
    const nonEmpty = [...groups.entries()]
      .filter(([, arr]) => arr.length > 0)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const prev = ordered.length ? (ordered[ordered.length - 1]!.article_type ?? 'other') : null;
    // Prefer a different group than the previous day; fall back to any.
    const pick = nonEmpty.find(([key]) => key !== prev) ?? nonEmpty[0]!;
    ordered.push(pick[1].shift()!);
  }

  return ordered.map((it, i) => ({ ...it, scheduled_date: addDays(startDate, i) }));
}
