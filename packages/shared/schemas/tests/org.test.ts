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
