import { describe, expect, test } from 'vitest';
import { EMPTY, formatDateTime, orEmpty } from '../src/lib/format';

// Orgs routinely arrive half-populated (no presets, no subscription, no domain
// rating), so the Overview leans on these two never producing "undefined" or
// "Invalid Date".

describe('formatDateTime', () => {
  test('renders an ISO timestamp in the local timezone', () => {
    expect(formatDateTime('2026-07-27T10:00:00.000Z')).toContain('2026');
  });

  test('renders absent or unparseable values as the empty marker', () => {
    expect(formatDateTime(null)).toBe(EMPTY);
    expect(formatDateTime(undefined)).toBe(EMPTY);
    expect(formatDateTime('')).toBe(EMPTY);
    expect(formatDateTime('not a date')).toBe(EMPTY);
  });
});

describe('orEmpty', () => {
  test('passes through present values, including zero', () => {
    expect(orEmpty('acme')).toBe('acme');
    expect(orEmpty(0)).toBe('0');
  });

  test('renders absent or blank values as the empty marker', () => {
    expect(orEmpty(null)).toBe(EMPTY);
    expect(orEmpty(undefined)).toBe(EMPTY);
    expect(orEmpty('')).toBe(EMPTY);
  });
});
