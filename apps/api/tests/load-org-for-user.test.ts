import { describe, expect, test, vi } from 'vitest';

const { findById, findByOrgAndEmail } = vi.hoisted(() => ({
  findById: vi.fn(),
  findByOrgAndEmail: vi.fn(),
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById },
  OrgMemberRepo: { findByOrgAndEmail },
}));

import { loadAccessibleOrg, loadOrgForUser } from '../src/lib/load-org-for-user';

const org = {
  id: 'o1',
  user_id: 'owner',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  plan: 'free',
  strategy_status: 'none',
  created_at: new Date(),
};
const owner = { userId: 'owner', email: 'owner@example.com' };
const teammate = { userId: 'mate', email: 'Mate@Example.com' };
const stranger = { userId: 'x', email: 'x@example.com' };

describe('loadOrgForUser', () => {
  test('null when the org is missing', async () => {
    findById.mockResolvedValueOnce(null);
    expect(await loadOrgForUser('o1', owner)).toBeNull();
    expect(findByOrgAndEmail).not.toHaveBeenCalled();
  });

  test('owner role for orgs.user_id, without touching org_members', async () => {
    findById.mockResolvedValueOnce(org);
    expect(await loadOrgForUser('o1', owner)).toEqual({ org, role: 'owner' });
    expect(findByOrgAndEmail).not.toHaveBeenCalled();
  });

  test('member role when an org_members row matches the lowercased email', async () => {
    findById.mockResolvedValueOnce(org);
    findByOrgAndEmail.mockResolvedValueOnce({ id: 'm1', org_id: 'o1', email: 'mate@example.com' });
    expect(await loadOrgForUser('o1', teammate)).toEqual({ org, role: 'member' });
    expect(findByOrgAndEmail).toHaveBeenCalledWith('o1', 'mate@example.com');
  });

  test('null for a stranger', async () => {
    findById.mockResolvedValueOnce(org);
    findByOrgAndEmail.mockResolvedValueOnce(null);
    expect(await loadOrgForUser('o1', stranger)).toBeNull();
  });
});

describe('loadAccessibleOrg', () => {
  test('returns the org for a member and null for a stranger', async () => {
    findById.mockResolvedValueOnce(org);
    findByOrgAndEmail.mockResolvedValueOnce({ id: 'm1', org_id: 'o1', email: 'mate@example.com' });
    expect(await loadAccessibleOrg('o1', teammate)).toEqual(org);

    findById.mockResolvedValueOnce(org);
    findByOrgAndEmail.mockResolvedValueOnce(null);
    expect(await loadAccessibleOrg('o1', stranger)).toBeNull();
  });
});
