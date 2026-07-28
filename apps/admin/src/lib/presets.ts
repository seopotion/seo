import type { SetupPresets } from '@shared/schemas';

/** The org's onboarding presets — the entity shape the admin DTO carries verbatim. */
export type Presets = SetupPresets;

/**
 * Deep-partial of the presets shape: nested objects are optional per key, while
 * arrays and scalars stay whole. That is exactly the PATCH body the admin API
 * deep-merges (`mergePresets`) — objects merge recursively, arrays replace.
 */
export type PresetsPatch = DeepPartial<Presets>;

type DeepPartial<T> =
  T extends Array<unknown> ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Presets arrays are all `string[]`, so element identity is the whole comparison. */
function sameArray(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((item, index) => Object.is(item, b[index]));
}

function diff(original: Record<string, unknown>, edited: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(edited)) {
    const before = original[key];
    if (isPlainObject(before) && isPlainObject(value)) {
      const nested = diff(before, value);
      if (Object.keys(nested).length > 0) out[key] = nested;
    } else if (Array.isArray(before) && Array.isArray(value)) {
      if (!sameArray(before, value)) out[key] = value;
    } else if (!Object.is(before, value)) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * The minimal patch that turns `original` into `edited`: only changed leaves
 * survive, each under its own path, and an edited array is carried whole because
 * the merge replaces arrays rather than unioning them. An untouched section is
 * absent entirely — that is what keeps a save from stomping a concurrent
 * customer edit to a section this operator never opened.
 */
export function diffPresets(original: Presets, edited: Presets): PresetsPatch {
  return diff(original, edited) as PresetsPatch;
}

/**
 * List fields are edited as text lines, so a draft carries blank and padded
 * entries while the operator types. The payload never should — normalizing at
 * save time (rather than on every keystroke) is also what lets the textarea keep
 * the caret where the operator put it.
 */
export function normalizePresets(draft: Presets): Presets {
  return normalize(draft) as Presets;
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === 'string' ? item.trim() : item)).filter(Boolean);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, normalize(nested)]),
    );
  }
  return value;
}
