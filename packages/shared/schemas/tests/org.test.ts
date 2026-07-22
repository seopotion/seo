import { describe, expect, test } from 'vitest';
import {
  CreateOrgInput,
  hasExpert,
  isPaid,
  ONBOARDING_INTEGRATIONS,
  OrgSchema,
  planRank,
} from '../src/org';

const base = {
  id: '1',
  user_id: 'u1',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  created_at: new Date(),
};

describe('OrgSchema entitlement', () => {
  test('plan and strategy_status default when absent (back-compat)', () => {
    const org = OrgSchema.parse(base);
    expect(org.plan).toBe('free');
    expect(org.strategy_status).toBe('none');
  });

  test('isPaid is true for paid and expert, false for free', () => {
    expect(isPaid(OrgSchema.parse({ ...base, plan: 'paid' }))).toBe(true);
    expect(isPaid(OrgSchema.parse({ ...base, plan: 'expert' }))).toBe(true);
    expect(isPaid(OrgSchema.parse(base))).toBe(false);
  });

  test('hasExpert is true only for the expert plan', () => {
    expect(hasExpert(OrgSchema.parse({ ...base, plan: 'expert' }))).toBe(true);
    expect(hasExpert(OrgSchema.parse({ ...base, plan: 'paid' }))).toBe(false);
    expect(hasExpert(OrgSchema.parse(base))).toBe(false);
  });

  test('planRank orders free < paid < expert', () => {
    expect(planRank('free')).toBe(0);
    expect(planRank('paid')).toBe(1);
    expect(planRank('expert')).toBe(2);
    expect(planRank('expert')).toBeGreaterThan(planRank('paid'));
    expect(planRank('paid')).toBeGreaterThan(planRank('free'));
  });

  test('accepts optional WordPress connection fields', () => {
    const connectedAt = new Date('2026-07-14T10:00:00.000Z');
    const org = OrgSchema.parse({
      ...base,
      wordpress_token: 'wordpress-token',
      wordpress_connected_at: connectedAt,
    });
    expect(org.wordpress_token).toBe('wordpress-token');
    expect(org.wordpress_connected_at).toEqual(connectedAt);
  });

  test('CreateOrgInput omits server-owned fields', () => {
    expect('id' in CreateOrgInput.shape).toBe(false);
    expect('created_at' in CreateOrgInput.shape).toBe(false);
    expect('presets' in CreateOrgInput.shape).toBe(false);
    expect('wordpress_token' in CreateOrgInput.shape).toBe(false);
    expect('wordpress_connected_at' in CreateOrgInput.shape).toBe(false);
    expect('user_id' in CreateOrgInput.shape).toBe(true);
  });
});

describe('OrgSchema domain rating', () => {
  test('is optional (back-compat with stored orgs)', () => {
    expect(OrgSchema.parse(base).domain_rating).toBeUndefined();
  });

  test('parses a stored value with its check timestamp', () => {
    const org = OrgSchema.parse({
      ...base,
      domain_rating: { value: 42, checked_at: new Date('2026-07-15T00:00:00Z') },
    });
    expect(org.domain_rating?.value).toBe(42);
  });

  test('rejects out-of-range values', () => {
    expect(() =>
      OrgSchema.parse({ ...base, domain_rating: { value: 101, checked_at: new Date() } }),
    ).toThrow();
  });
});

describe('OrgSchema.onboarding', () => {
  test('onboarding is optional', () => {
    expect(OrgSchema.parse(base).onboarding).toBeUndefined();
  });

  test('accepts referral_source + valid integrations', () => {
    const org = OrgSchema.parse({
      ...base,
      onboarding: { referral_source: 'LinkedIn', integrations: ['wordpress', 'framer'] },
    });
    expect(org.onboarding).toEqual({
      referral_source: 'LinkedIn',
      integrations: ['wordpress', 'framer'],
    });
  });

  test('rejects an unknown integration id', () => {
    expect(() => OrgSchema.parse({ ...base, onboarding: { integrations: ['wix'] } })).toThrow();
  });

  test('exposes the integration enum values', () => {
    expect(ONBOARDING_INTEGRATIONS).toEqual(['wordpress', 'wordpress-com', 'framer']);
  });
});
