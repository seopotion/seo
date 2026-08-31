import { describe, expect, test } from 'vitest';
import {
  hasPurchasableTier,
  TIERS,
  tierState,
} from '../app/[locale]/(authenticated)/(product)/billing/tiers';

describe('tierState', () => {
  test('offers both tiers to a free org', () => {
    expect(tierState('free', 'paid')).toBe('upgrade');
    expect(tierState('free', 'expert')).toBe('upgrade');
  });

  test('marks the subscribed tier current and keeps the higher tier purchasable', () => {
    expect(tierState('paid', 'paid')).toBe('current');
    expect(tierState('paid', 'expert')).toBe('upgrade');
  });

  test('marks a lower tier owned once the org is on the top tier', () => {
    expect(tierState('expert', 'expert')).toBe('current');
    expect(tierState('expert', 'paid')).toBe('owned');
  });

  test('never reports upgrade for a tier the backend would reject', () => {
    // apps/api/src/routes/billing.ts returns 409 at equal-or-higher plan rank.
    expect(TIERS.filter((tier) => tierState('expert', tier) === 'upgrade')).toEqual([]);
    expect(TIERS.filter((tier) => tierState('paid', tier) === 'upgrade')).toEqual(['expert']);
  });
});

describe('hasPurchasableTier', () => {
  test('is true while something is still buyable', () => {
    expect(hasPurchasableTier('free')).toBe(true);
    expect(hasPurchasableTier('paid')).toBe(true);
  });

  test('is false on the top tier', () => {
    expect(hasPurchasableTier('expert')).toBe(false);
  });
});
