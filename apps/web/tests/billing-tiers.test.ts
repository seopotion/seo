import { describe, expect, test } from 'vitest';
import {
  hasPurchasableTier,
  isActivated,
  parsePurchasedTier,
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

const org = (billing_tier: 'free' | 'paid' | 'expert') => ({
  billing_tier,
  // Mirrors the API: both paid tiers map to the same capability flag.
  capabilities: { keyword_research: billing_tier !== 'free' },
});

describe('parsePurchasedTier', () => {
  test('accepts the tiers we sell', () => {
    expect(parsePurchasedTier('paid')).toBe('paid');
    expect(parsePurchasedTier('expert')).toBe('expert');
  });

  test('rejects anything else, so the poll falls back', () => {
    // `free` is the absence of a purchase, never a checkout redirect.
    expect(parsePurchasedTier('free')).toBeNull();
    expect(parsePurchasedTier('bogus')).toBeNull();
    expect(parsePurchasedTier('')).toBeNull();
    expect(parsePurchasedTier(null)).toBeNull();
    expect(parsePurchasedTier(undefined)).toBeNull();
  });
});

describe('isActivated', () => {
  test('keeps polling while a paid org has not reached the expert tier it bought', () => {
    // The regression this predicate exists for: `keyword_research` is already
    // true here, so the old check ended the poll before the webhook landed.
    expect(org('paid').capabilities.keyword_research).toBe(true);
    expect(isActivated(org('paid'), 'expert')).toBe(false);
  });

  test('is done once the org reaches the purchased tier', () => {
    expect(isActivated(org('expert'), 'expert')).toBe(true);
    expect(isActivated(org('paid'), 'paid')).toBe(true);
  });

  test('is done when the org outranks the purchased tier', () => {
    expect(isActivated(org('expert'), 'paid')).toBe(true);
  });

  test('keeps polling while a free org has not been upgraded', () => {
    expect(isActivated(org('free'), 'paid')).toBe(false);
    expect(isActivated(org('free'), 'expert')).toBe(false);
  });

  test('falls back to the paid capability with no tier param (old checkout links)', () => {
    expect(isActivated(org('free'), null)).toBe(false);
    expect(isActivated(org('paid'), null)).toBe(true);
    expect(isActivated(org('expert'), null)).toBe(true);
  });

  test('keeps polling while the org list has not resolved', () => {
    expect(isActivated(null, 'expert')).toBe(false);
    expect(isActivated(null, null)).toBe(false);
  });
});
