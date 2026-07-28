import { describe, expect, test } from 'vitest';
import { ApiError } from '../src/lib/api';
import { errorMessage, errorText } from '../src/lib/errors';

describe('errorMessage', () => {
  test('maps known API codes to operator-readable copy', () => {
    for (const code of ['not_found', 'no_presets', 'strategy_not_claimable']) {
      expect(errorMessage(code)).not.toBe(code);
    }
  });

  test('falls back to the raw code for anything unmapped', () => {
    // Better than a generic "something went wrong": the operator can still act
    // on a code they can read.
    expect(errorMessage('wordpress_not_connected')).toBe('wordpress_not_connected');
  });
});

describe('errorText', () => {
  test('renders the mapped message for an ApiError', () => {
    expect(errorText(new ApiError('no_presets', 409), 'fallback')).toBe(errorMessage('no_presets'));
  });

  test('uses the fallback for anything else', () => {
    expect(errorText(new TypeError('fetch failed'), 'Search failed.')).toBe('Search failed.');
  });
});
