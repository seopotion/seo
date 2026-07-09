import { afterEach, describe, expect, test, vi } from 'vitest';

const { ensureIndexes, closeDb, setPlan, findByUserId, findByEmail } = vi.hoisted(() => ({
  ensureIndexes: vi.fn(async () => {}),
  closeDb: vi.fn(async () => {}),
  setPlan: vi.fn(async () => true),
  findByUserId: vi.fn(async () => [{ id: 'org_1' }]),
  findByEmail: vi.fn(
    async (): Promise<{ id: string; email: string } | null> => ({
      id: 'u_1',
      email: 'dev@example.com',
    }),
  ),
}));

vi.mock('@shared/db', () => ({
  ensureIndexes,
  closeDb,
  OrgRepo: { setPlan, findByUserId },
  UserRepo: { findByEmail },
}));

import { initDb, setOrgPlan } from '../src/lib/db';

afterEach(() => vi.clearAllMocks());

describe('initDb', () => {
  test('calls ensureIndexes and returns the collection list', async () => {
    const res = await initDb();
    expect(ensureIndexes).toHaveBeenCalledOnce();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.collections).toEqual(['users', 'orgs']);
  });

  test('maps a thrown error to a DB_INIT_FAILED Result', async () => {
    ensureIndexes.mockRejectedValueOnce(new Error('no mongo'));
    const res = await initDb();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('DB_INIT_FAILED');
    expect(res.error.message).toContain('no mongo');
    expect(closeDb).toHaveBeenCalledOnce();
  });
});

describe('setOrgPlan', () => {
  test('sets the plan for an org id', async () => {
    const res = await setOrgPlan({ org: 'org_1', plan: 'paid' });
    expect(setPlan).toHaveBeenCalledWith('org_1', 'paid');
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'paid' });
  });

  test('resolves the org from a user email', async () => {
    const res = await setOrgPlan({ user: 'dev@example.com', plan: 'paid' });
    expect(findByEmail).toHaveBeenCalledWith('dev@example.com');
    expect(setPlan).toHaveBeenCalledWith('org_1', 'paid');
    expect(res.ok).toBe(true);
  });

  test('rejects a plan outside the entitlement set', async () => {
    const res = await setOrgPlan({ org: 'org_1', plan: 'gold' });
    expect(setPlan).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('INVALID_PLAN');
  });

  test('requires exactly one of org or user', async () => {
    const neither = await setOrgPlan({ plan: 'paid' });
    expect(neither.ok).toBe(false);
    if (neither.ok) throw new Error('expected failure');
    expect(neither.error.code).toBe('BAD_TARGET');

    const both = await setOrgPlan({ org: 'org_1', user: 'dev@example.com', plan: 'paid' });
    expect(both.ok).toBe(false);
  });

  test('fails when the org id matches nothing', async () => {
    setPlan.mockResolvedValueOnce(false);
    const res = await setOrgPlan({ org: 'missing', plan: 'paid' });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('ORG_NOT_FOUND');
  });

  test('fails when the user email matches no user', async () => {
    findByEmail.mockResolvedValueOnce(null);
    const res = await setOrgPlan({ user: 'nobody@example.com', plan: 'paid' });
    expect(setPlan).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('USER_NOT_FOUND');
  });

  test('fails ambiguously when the user owns multiple orgs', async () => {
    findByUserId.mockResolvedValueOnce([{ id: 'org_1' }, { id: 'org_2' }]);
    const res = await setOrgPlan({ user: 'dev@example.com', plan: 'paid' });
    expect(setPlan).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('AMBIGUOUS_ORG');
    expect(res.error.message).toContain('org_2');
  });
});
