import { describe, expect, test, vi } from 'vitest';

const { findById } = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('@shared/db', () => ({ OrgRepo: { findById } }));

import { loadOwnedPaidOrg } from '../src/lib/load-owned-paid-org';

const org = (over: Record<string, unknown>) => ({
  id: 'o1',
  user_id: 'u1',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  plan: 'paid',
  strategy_status: 'none',
  created_at: new Date(),
  ...over,
});

describe('loadOwnedPaidOrg', () => {
  test('not_found when missing', async () => {
    findById.mockResolvedValueOnce(null);
    expect(await loadOwnedPaidOrg('o1', 'u1')).toEqual({ ok: false, reason: 'not_found' });
  });
  test('not_owner for a different user', async () => {
    findById.mockResolvedValueOnce(org({ user_id: 'someone_else' }));
    expect(await loadOwnedPaidOrg('o1', 'u1')).toEqual({ ok: false, reason: 'not_owner' });
  });
  test('not_paid for free plan', async () => {
    findById.mockResolvedValueOnce(org({ plan: 'free' }));
    expect(await loadOwnedPaidOrg('o1', 'u1')).toEqual({ ok: false, reason: 'not_paid' });
  });
  test('ok for owned paid org', async () => {
    const paid = org({});
    findById.mockResolvedValueOnce(paid);
    expect(await loadOwnedPaidOrg('o1', 'u1')).toEqual({ ok: true, org: paid });
  });
});
