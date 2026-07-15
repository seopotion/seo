import { describe, expect, test } from 'vitest';
import { isPaid, OrgSchema } from '../src/org';

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

  test('isPaid is true only for the paid plan', () => {
    expect(isPaid(OrgSchema.parse({ ...base, plan: 'paid' }))).toBe(true);
    expect(isPaid(OrgSchema.parse({ ...base, plan: 'trial' }))).toBe(false);
    expect(isPaid(OrgSchema.parse(base))).toBe(false);
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
