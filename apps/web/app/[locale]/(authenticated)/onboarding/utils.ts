import type { TextEntry } from './types';

export function createEntryId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function stringsToTextEntries(values: string[], prefix: string): TextEntry[] {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => ({ id: `${prefix}-${index}`, value }));
}

export function textEntriesToStrings(entries: TextEntry[]): string[] {
  return entries.map((entry) => entry.value.trim()).filter(Boolean);
}

export function isValidHttpUrl(value: string) {
  const trimmedValue = value.trim();

  if (!trimmedValue) return false;

  try {
    const url = new URL(trimmedValue);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
