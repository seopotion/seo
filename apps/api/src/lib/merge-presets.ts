import type { SetupPresets } from '@shared/schemas';

/** Recursive partial: every nested object property is optional, arrays/scalars stay whole. */
export type DeepPartial<T> =
  T extends Array<unknown> ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge<T>(target: T, patch: DeepPartial<T>): T {
  if (!isPlainObject(target) || !isPlainObject(patch)) {
    // Scalars and arrays: the patch value replaces the target wholesale.
    return patch as T;
  }
  const out: Record<string, unknown> = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    out[key] = deepMerge((target as Record<string, unknown>)[key], value as DeepPartial<unknown>);
  }
  return out as T;
}

/**
 * Deep-merge a partial presets patch into existing presets. Nested objects merge
 * recursively (so `{ business: { name } }` keeps the other business fields);
 * array fields (competitors, best_articles) are replaced wholesale. Does not
 * mutate `existing`. An `undefined` patch returns `existing` unchanged.
 */
export function mergePresets(
  existing: SetupPresets,
  partial: DeepPartial<SetupPresets> | undefined,
): SetupPresets {
  if (partial === undefined) return existing;
  return deepMerge(existing, partial) as SetupPresets;
}
