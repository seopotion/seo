import { afterEach, describe, expect, test, vi } from 'vitest';

const {
  ensureIndexes,
  runMigrations,
  closeDb,
  setPlan,
  findById,
  claimStrategy,
  setStrategyStatus,
  findByUserId,
  findByEmail,
  deleteOrgById,
  deleteKeywordsByOrgId,
  deleteCandidatesByOrgId,
  deleteArticlesByOrgId,
  enqueueStrategyTask,
} = vi.hoisted(() => ({
  ensureIndexes: vi.fn(async () => {}),
  runMigrations: vi.fn(async () => ({
    audience_target_migrated: 2,
    normalized_backfilled: 0,
    date_dupes_resolved: 0,
    keyword_dupes_removed: 0,
  })),
  closeDb: vi.fn(async () => {}),
  setPlan: vi.fn(async () => true),
  // Default: a finalized org with presets, so paid escalation kicks off strategy.
  findById: vi.fn(
    async (): Promise<{ setup_status: string; presets: unknown } | null> => ({
      setup_status: 'setup_complete',
      presets: { audience: {} },
    }),
  ),
  claimStrategy: vi.fn(async () => true),
  setStrategyStatus: vi.fn(async () => {}),
  findByUserId: vi.fn(async () => [{ id: 'org_1' }]),
  findByEmail: vi.fn(
    async (): Promise<{ id: string; email: string } | null> => ({
      id: 'u_1',
      email: 'dev@example.com',
    }),
  ),
  deleteOrgById: vi.fn(async () => true),
  deleteKeywordsByOrgId: vi.fn(async () => 3),
  deleteCandidatesByOrgId: vi.fn(async () => 2),
  deleteArticlesByOrgId: vi.fn(async () => 1),
  enqueueStrategyTask: vi.fn(async () => {}),
}));

vi.mock('@shared/db', () => ({
  ensureIndexes,
  runMigrations,
  closeDb,
  OrgRepo: {
    setPlan,
    findById,
    claimStrategy,
    setStrategyStatus,
    findByUserId,
    deleteById: deleteOrgById,
  },
  UserRepo: { findByEmail },
  KeywordRepo: { deleteByOrgId: deleteKeywordsByOrgId },
  CandidateRepo: { deleteByOrgId: deleteCandidatesByOrgId },
  ArticleRepo: { deleteByOrgId: deleteArticlesByOrgId },
}));

vi.mock('../src/lib/sqs', () => ({ enqueueStrategyTask }));

import { initDb, migrateDb, resetUser, setOrgPlan } from '../src/lib/db';

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

describe('migrateDb', () => {
  test('runs migrations and returns the report', async () => {
    const res = await migrateDb();
    expect(runMigrations).toHaveBeenCalledOnce();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.audience_target_migrated).toBe(2);
  });

  test('maps a thrown error to a DB_MIGRATE_FAILED Result', async () => {
    runMigrations.mockRejectedValueOnce(new Error('no mongo'));
    const res = await migrateDb();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('DB_MIGRATE_FAILED');
    expect(closeDb).toHaveBeenCalledOnce();
  });
});

describe('setOrgPlan', () => {
  test('sets the plan for an org id and kicks off strategy for a finalized paid org', async () => {
    const res = await setOrgPlan({ org: 'org_1', plan: 'paid' });
    expect(setPlan).toHaveBeenCalledWith('org_1', 'paid');
    expect(claimStrategy).toHaveBeenCalledWith('org_1');
    expect(enqueueStrategyTask).toHaveBeenCalledWith({ org_id: 'org_1' });
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'paid', strategy_enqueued: true });
  });

  test('resolves the org from a user email', async () => {
    const res = await setOrgPlan({ user: 'dev@example.com', plan: 'paid' });
    expect(findByEmail).toHaveBeenCalledWith('dev@example.com');
    expect(setPlan).toHaveBeenCalledWith('org_1', 'paid');
    expect(res.ok).toBe(true);
  });

  test('kicks off strategy for the expert tier too', async () => {
    const res = await setOrgPlan({ org: 'org_1', plan: 'expert' });
    expect(setPlan).toHaveBeenCalledWith('org_1', 'expert');
    expect(claimStrategy).toHaveBeenCalledWith('org_1');
    expect(enqueueStrategyTask).toHaveBeenCalledWith({ org_id: 'org_1' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'expert', strategy_enqueued: true });
  });

  test('does not enqueue strategy when setting a non-paid plan', async () => {
    const res = await setOrgPlan({ org: 'org_1', plan: 'free' });
    expect(setPlan).toHaveBeenCalledWith('org_1', 'free');
    expect(claimStrategy).not.toHaveBeenCalled();
    expect(enqueueStrategyTask).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'free', strategy_enqueued: false });
  });

  test('does not enqueue strategy when the org has not finalized setup', async () => {
    findById.mockResolvedValueOnce({ setup_status: 'setup_scan_completed', presets: null });
    const res = await setOrgPlan({ org: 'org_1', plan: 'paid' });
    expect(setPlan).toHaveBeenCalledWith('org_1', 'paid');
    expect(claimStrategy).not.toHaveBeenCalled();
    expect(enqueueStrategyTask).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'paid', strategy_enqueued: false });
  });

  test('does not enqueue strategy when it was already claimed', async () => {
    claimStrategy.mockResolvedValueOnce(false);
    const res = await setOrgPlan({ org: 'org_1', plan: 'paid' });
    expect(claimStrategy).toHaveBeenCalledWith('org_1');
    expect(enqueueStrategyTask).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'paid', strategy_enqueued: false });
  });

  test('reverts the strategy claim and fails when enqueue throws', async () => {
    enqueueStrategyTask.mockRejectedValueOnce(new Error('no queue url'));
    const res = await setOrgPlan({ org: 'org_1', plan: 'paid' });
    expect(claimStrategy).toHaveBeenCalledWith('org_1');
    expect(setStrategyStatus).toHaveBeenCalledWith('org_1', 'failed');
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('STRATEGY_ENQUEUE_FAILED');
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

describe('resetUser', () => {
  test('deletes org data, the org, and reports counts', async () => {
    const res = await resetUser({ user: 'dev@example.com' });
    expect(findByEmail).toHaveBeenCalledWith('dev@example.com');
    expect(deleteKeywordsByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteCandidatesByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteArticlesByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteOrgById).toHaveBeenCalledWith('org_1');
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({
      user_id: 'u_1',
      org_ids: ['org_1'],
      deleted: { orgs: 1, keywords: 3, candidates: 2, articles: 1 },
    });
  });

  test('wipes every org for a multi-org user, summing counts', async () => {
    findByUserId.mockResolvedValueOnce([{ id: 'org_1' }, { id: 'org_2' }]);
    const res = await resetUser({ user: 'dev@example.com' });
    expect(deleteKeywordsByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteKeywordsByOrgId).toHaveBeenCalledWith('org_2');
    expect(deleteOrgById).toHaveBeenCalledTimes(2);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.org_ids).toEqual(['org_1', 'org_2']);
    expect(res.data.deleted).toEqual({ orgs: 2, keywords: 6, candidates: 4, articles: 2 });
  });

  test('succeeds with zero counts when the user owns no org', async () => {
    findByUserId.mockResolvedValueOnce([]);
    const res = await resetUser({ user: 'dev@example.com' });
    expect(deleteKeywordsByOrgId).not.toHaveBeenCalled();
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.deleted).toEqual({ orgs: 0, keywords: 0, candidates: 0, articles: 0 });
  });

  test('fails when the email matches no user', async () => {
    findByEmail.mockResolvedValueOnce(null);
    const res = await resetUser({ user: 'nobody@example.com' });
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('USER_NOT_FOUND');
  });

  test('fails without --user', async () => {
    const res = await resetUser({});
    expect(findByEmail).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('BAD_TARGET');
  });
});
