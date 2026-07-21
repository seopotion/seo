import { describe, expect, test } from 'vitest';
import { CreateOrgInput, isPaid, OrgSchema } from '../src/org';

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
