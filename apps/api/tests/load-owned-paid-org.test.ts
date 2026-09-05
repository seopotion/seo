import { describe, expect, test, vi } from 'vitest';

const { findById, findByOrgAndEmail } = vi.hoisted(() => ({
  findById: vi.fn(),
  findByOrgAndEmail: vi.fn(),
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  OrgMemberRepo: { findByOrgAndEmail },
}));

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
const owner = { userId: 'u1', email: 'u1@example.com' };
const teammate = { userId: 'u2', email: 'u2@example.com' };

describe('loadOwnedPaidOrg', () => {
  test('not_found when missing', async () => {
    findById.mockResolvedValueOnce(null);
    expect(await loadOwnedPaidOrg('o1', owner)).toEqual({ ok: false, reason: 'not_found' });
  });
  test('not_found for a stranger (existence never leaks)', async () => {
    findById.mockResolvedValueOnce(org({ user_id: 'someone_else' }));
    findByOrgAndEmail.mockResolvedValueOnce(null);
    expect(await loadOwnedPaidOrg('o1', owner)).toEqual({ ok: false, reason: 'not_found' });
  });
  test('not_paid for free plan', async () => {
    findById.mockResolvedValueOnce(org({ plan: 'free' }));
    expect(await loadOwnedPaidOrg('o1', owner)).toEqual({ ok: false, reason: 'not_paid' });
  });
  test('ok for an owned paid org', async () => {
    const paid = org({});
    findById.mockResolvedValueOnce(paid);
    expect(await loadOwnedPaidOrg('o1', owner)).toEqual({ ok: true, org: paid });
  });
  test('ok for a member of a paid org', async () => {
    const paid = org({});
    findById.mockResolvedValueOnce(paid);
    findByOrgAndEmail.mockResolvedValueOnce({ id: 'm1', org_id: 'o1', email: 'u2@example.com' });
    expect(await loadOwnedPaidOrg('o1', teammate)).toEqual({ ok: true, org: paid });
  });
});
