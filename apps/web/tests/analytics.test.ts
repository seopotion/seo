import { describe, expect, test } from 'vitest';
import {
  formatCtr,
  formatDelta,
  formatPosition,
  getDeltaSentiment,
  needsAttention,
} from '../lib/analytics';

describe('analytics formatting', () => {
  test('formats raw GSC ctr fractions as percentages', () => {
    expect(formatCtr(0.034, 'en-US')).toBe('3.4%');
  });

  test('formats positions with one decimal place', () => {
    expect(formatPosition(8, 'en-US')).toBe('8.0');
    expect(formatPosition(8.46, 'en-US')).toBe('8.5');
  });

  test('formats fractional metric deltas as percentage changes', () => {
    expect(formatDelta('clicks', 0.12, 'en-US')).toBe('+12.0%');
    expect(formatDelta('ctr', -0.034, 'en-US')).toBe('-3.4%');
    expect(formatDelta('impressions', null, 'en-US')).toBe('—');
  });

  test('formats position delta as an absolute change', () => {
    expect(formatDelta('position', -1.25, 'en-US')).toBe('-1.3');
  });
});

describe('analytics direction', () => {
  test('treats positive traffic deltas as improvements', () => {
    expect(getDeltaSentiment('clicks', 0.12)).toBe('positive');
    expect(getDeltaSentiment('impressions', -0.12)).toBe('negative');
  });

  test('inverts position deltas because lower position is better', () => {
    expect(getDeltaSentiment('position', -1.2)).toBe('positive');
    expect(getDeltaSentiment('position', 1.2)).toBe('negative');
  });

  test('keeps missing and unchanged deltas neutral', () => {
    expect(getDeltaSentiment('ctr', null)).toBe('neutral');
    expect(getDeltaSentiment('position', 0)).toBe('neutral');
  });
});

describe('needsAttention', () => {
  test('requires all pinned thresholds', () => {
    expect(needsAttention({ impressions: 200, ctr: 0.009, position: 4 })).toBe(true);
    expect(needsAttention({ impressions: 200, ctr: 0.009, position: 10 })).toBe(true);
    expect(needsAttention({ impressions: 199, ctr: 0.009, position: 7 })).toBe(false);
    expect(needsAttention({ impressions: 200, ctr: 0.01, position: 7 })).toBe(false);
    expect(needsAttention({ impressions: 200, ctr: 0.009, position: 10.1 })).toBe(false);
  });
});
