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
  deleteGscConnectionByOrgId,
  deleteSubscriptionsByOrgId,
  deleteIntegrationsByOrgId,
  deleteStrategyRunsByOrgId,
  deleteGscCacheByOrgId,
  listAllSummaries,
  listActiveByOrg,
  deleteUserById,
  launchStrategy,
  createStrategyRun,
  runLocalStrategy,
  cancelSubscription,
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
    async (): Promise<{ id: string; setup_status: string; presets: unknown } | null> => ({
      id: 'org_1',
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
  deleteGscConnectionByOrgId: vi.fn(async () => true),
  deleteSubscriptionsByOrgId: vi.fn(async () => 1),
  deleteIntegrationsByOrgId: vi.fn(async () => 1),
  deleteStrategyRunsByOrgId: vi.fn(async () => 4),
  deleteGscCacheByOrgId: vi.fn(async () => 5),
  // Two orgs: `keep` sweeps target whichever is not named.
  listAllSummaries: vi.fn(async () => [
    {
      id: 'org_keep',
      website_url: 'https://keep.example.com',
      user_id: 'u_1',
      plan: 'paid',
      setup_status: 'setup_complete',
    },
    {
      id: 'org_1',
      website_url: 'https://nuke.example.com',
      user_id: 'u_2',
      plan: 'free',
      setup_status: 'setup_complete',
    },
  ]),
  listActiveByOrg: vi.fn(async (): Promise<{ provider_subscription_id: string }[]> => []),
  deleteUserById: vi.fn(async () => true),
  launchStrategy: vi.fn(async () => ({ run_id: 'run_1' })),
  createStrategyRun: vi.fn(async () => ({ id: 'run_1' })),
  runLocalStrategy: vi.fn(async () => {}),
  cancelSubscription: vi.fn(async () => {}),
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
    listAllSummaries,
    deleteById: deleteOrgById,
  },
  UserRepo: { findByEmail, deleteById: deleteUserById },
  KeywordRepo: { deleteByOrgId: deleteKeywordsByOrgId },
  CandidateRepo: { deleteByOrgId: deleteCandidatesByOrgId },
  ArticleRepo: { deleteByOrgId: deleteArticlesByOrgId },
  GscConnectionRepo: { deleteByOrgId: deleteGscConnectionByOrgId },
  SubscriptionRepo: { deleteByOrgId: deleteSubscriptionsByOrgId, listActiveByOrg },
  IntegrationRepo: { deleteByOrgId: deleteIntegrationsByOrgId },
  StrategyRunRepo: { deleteByOrgId: deleteStrategyRunsByOrgId },
  GscAnalyticsCacheRepo: { deleteByOrgId: deleteGscCacheByOrgId },
}));

vi.mock('@shared/strategy', () => ({ launchStrategy, createStrategyRun, runLocalStrategy }));

vi.mock('@shared/providers', () => ({
  createLemonSqueezyProvider: () => ({ cancelSubscription }),
}));

import {
  deleteOrgs,
  deleteUser,
  initDb,
  migrateDb,
  resetUser,
  setOrgPlan,
  strategyRun,
} from '../src/lib/db';

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
    expect(launchStrategy).toHaveBeenCalledWith('org_1', { wait: true });
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
    expect(launchStrategy).toHaveBeenCalledWith('org_1', { wait: true });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'expert', strategy_enqueued: true });
  });

  test('does not launch strategy when setting a non-paid plan', async () => {
    const res = await setOrgPlan({ org: 'org_1', plan: 'free' });
    expect(setPlan).toHaveBeenCalledWith('org_1', 'free');
    expect(claimStrategy).not.toHaveBeenCalled();
    expect(launchStrategy).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'free', strategy_enqueued: false });
  });

  test('does not launch strategy when the org has not finalized setup', async () => {
    findById.mockResolvedValueOnce({
      id: 'org_1',
      setup_status: 'setup_scan_completed',
      presets: null,
    });
    const res = await setOrgPlan({ org: 'org_1', plan: 'paid' });
    expect(setPlan).toHaveBeenCalledWith('org_1', 'paid');
    expect(claimStrategy).not.toHaveBeenCalled();
    expect(launchStrategy).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'paid', strategy_enqueued: false });
  });

  test('does not launch strategy when it was already claimed', async () => {
    claimStrategy.mockResolvedValueOnce(false);
    const res = await setOrgPlan({ org: 'org_1', plan: 'paid' });
    expect(claimStrategy).toHaveBeenCalledWith('org_1');
    expect(launchStrategy).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ org_id: 'org_1', plan: 'paid', strategy_enqueued: false });
  });

  test('reverts the strategy claim and fails when the launch throws', async () => {
    launchStrategy.mockRejectedValueOnce(new Error('run failed'));
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

describe('strategyRun', () => {
  test('creates and executes a strategy run for an existing, finalized org', async () => {
    const res = await strategyRun({ orgId: 'org_1' });
    expect(findById).toHaveBeenCalledWith('org_1');
    expect(createStrategyRun).toHaveBeenCalledWith('org_1');
    expect(runLocalStrategy).toHaveBeenCalledWith('run_1');
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({ run_id: 'run_1' });
  });

  test('fails when the org id matches nothing', async () => {
    findById.mockResolvedValueOnce(null);
    const res = await strategyRun({ orgId: 'missing' });
    expect(createStrategyRun).not.toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('ORG_NOT_FOUND');
  });

  test('fails when the org has not finalized setup (no presets)', async () => {
    findById.mockResolvedValueOnce({
      id: 'org_1',
      setup_status: 'setup_scan_completed',
      presets: null,
    });
    const res = await strategyRun({ orgId: 'org_1' });
    expect(createStrategyRun).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('ORG_NOT_FINALIZED');
  });

  test('propagates an unexpected failure from the pipeline itself', async () => {
    runLocalStrategy.mockRejectedValueOnce(new Error('stage blew up'));
    await expect(strategyRun({ orgId: 'org_1' })).rejects.toThrow('stage blew up');
    expect(closeDb).toHaveBeenCalledOnce();
  });
});

describe('resetUser', () => {
  test('deletes org data (incl. gsc + subscriptions), the org, and reports counts', async () => {
    const res = await resetUser({ user: 'dev@example.com' });
    expect(findByEmail).toHaveBeenCalledWith('dev@example.com');
    expect(deleteKeywordsByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteCandidatesByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteArticlesByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteGscConnectionByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteSubscriptionsByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteOrgById).toHaveBeenCalledWith('org_1');
    expect(deleteUserById).not.toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({
      user_id: 'u_1',
      org_ids: ['org_1'],
      cancelled_subscriptions: 0,
      deleted: {
        orgs: 1,
        keywords: 3,
        candidates: 2,
        articles: 1,
        gsc_connections: 1,
        subscriptions: 1,
      },
    });
  });

  test('cancels active provider subscriptions before deleting anything', async () => {
    process.env.LEMONSQUEEZY_API_KEY = 'test-key';
    listActiveByOrg.mockResolvedValueOnce([{ provider_subscription_id: 'sub_9' }]);
    const res = await resetUser({ user: 'dev@example.com' });
    expect(cancelSubscription).toHaveBeenCalledWith('sub_9');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.cancelled_subscriptions).toBe(1);
    delete process.env.LEMONSQUEEZY_API_KEY;
  });

  test('fails before deleting when an active sub exists but LEMONSQUEEZY_API_KEY is unset', async () => {
    delete process.env.LEMONSQUEEZY_API_KEY;
    listActiveByOrg.mockResolvedValueOnce([{ provider_subscription_id: 'sub_9' }]);
    const res = await resetUser({ user: 'dev@example.com' });
    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('SUB_CANCEL_FAILED');
  });

  test('fails before deleting when the provider cancel call throws', async () => {
    process.env.LEMONSQUEEZY_API_KEY = 'test-key';
    listActiveByOrg.mockResolvedValueOnce([{ provider_subscription_id: 'sub_9' }]);
    cancelSubscription.mockRejectedValueOnce(new Error('LS down'));
    const res = await resetUser({ user: 'dev@example.com' });
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('SUB_CANCEL_FAILED');
    delete process.env.LEMONSQUEEZY_API_KEY;
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
    expect(res.data.deleted).toEqual({
      orgs: 2,
      keywords: 6,
      candidates: 4,
      articles: 2,
      gsc_connections: 2,
      subscriptions: 2,
    });
  });

  test('succeeds with zero counts when the user owns no org', async () => {
    findByUserId.mockResolvedValueOnce([]);
    const res = await resetUser({ user: 'dev@example.com' });
    expect(deleteKeywordsByOrgId).not.toHaveBeenCalled();
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.deleted).toEqual({
      orgs: 0,
      keywords: 0,
      candidates: 0,
      articles: 0,
      gsc_connections: 0,
      subscriptions: 0,
    });
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

describe('deleteUser', () => {
  test('wipes org data like reset and deletes the user document too', async () => {
    const res = await deleteUser({ user: 'dev@example.com' });
    expect(deleteKeywordsByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteSubscriptionsByOrgId).toHaveBeenCalledWith('org_1');
    expect(deleteOrgById).toHaveBeenCalledWith('org_1');
    expect(deleteUserById).toHaveBeenCalledWith('u_1');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data).toEqual({
      user_id: 'u_1',
      org_ids: ['org_1'],
      cancelled_subscriptions: 0,
      user_deleted: true,
      deleted: {
        orgs: 1,
        keywords: 3,
        candidates: 2,
        articles: 1,
        gsc_connections: 1,
        subscriptions: 1,
      },
    });
  });

  test('cancels active provider subscriptions before deleting', async () => {
    process.env.LEMONSQUEEZY_API_KEY = 'test-key';
    listActiveByOrg.mockResolvedValueOnce([{ provider_subscription_id: 'sub_9' }]);
    const res = await deleteUser({ user: 'dev@example.com' });
    expect(cancelSubscription).toHaveBeenCalledWith('sub_9');
    expect(deleteUserById).toHaveBeenCalledWith('u_1');
    expect(res.ok).toBe(true);
    delete process.env.LEMONSQUEEZY_API_KEY;
  });

  test('fails without --user', async () => {
    const res = await deleteUser({});
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('BAD_TARGET');
  });

  test('fails when the email matches no user', async () => {
    findByEmail.mockResolvedValueOnce(null);
    const res = await deleteUser({ user: 'nobody@example.com' });
    expect(deleteUserById).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('deleteOrgs', () => {
  test('dry run reports the targets and writes nothing', async () => {
    const res = await deleteOrgs({ keep: ['org_keep'], apply: false });
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(deleteKeywordsByOrgId).not.toHaveBeenCalled();
    expect(closeDb).toHaveBeenCalledOnce();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.apply).toBe(false);
    expect(res.data.orgs.map((o) => o.id)).toEqual(['org_1']);
    expect(res.data.deleted.orgs).toBe(0);
  });

  test('--keep deletes every other org across all org-scoped collections', async () => {
    const res = await deleteOrgs({ keep: ['org_keep'], apply: true });
    for (const fn of [
      deleteKeywordsByOrgId,
      deleteCandidatesByOrgId,
      deleteArticlesByOrgId,
      deleteGscConnectionByOrgId,
      deleteSubscriptionsByOrgId,
      deleteIntegrationsByOrgId,
      deleteStrategyRunsByOrgId,
      deleteGscCacheByOrgId,
      deleteOrgById,
    ]) {
      expect(fn).toHaveBeenCalledExactlyOnceWith('org_1');
    }
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.deleted).toEqual({
      orgs: 1,
      keywords: 3,
      candidates: 2,
      articles: 1,
      gsc_connections: 1,
      subscriptions: 1,
      integrations: 1,
      strategy_runs: 4,
      gsc_analytics_cache: 5,
    });
  });

  test('never touches users', async () => {
    await deleteOrgs({ keep: ['org_keep'], apply: true });
    expect(deleteUserById).not.toHaveBeenCalled();
  });

  test('--org targets exactly the named ids', async () => {
    const res = await deleteOrgs({ orgs: ['org_1'], apply: true });
    expect(deleteOrgById).toHaveBeenCalledExactlyOnceWith('org_1');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.orgs.map((o) => o.id)).toEqual(['org_1']);
  });

  test('an unknown --keep id aborts the sweep rather than deleting everything', async () => {
    const res = await deleteOrgs({ keep: ['org_typo'], apply: true });
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('ORG_NOT_FOUND');
  });

  test('an unknown --org id aborts before deleting the known ones', async () => {
    const res = await deleteOrgs({ orgs: ['org_1', 'org_typo'], apply: true });
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('ORG_NOT_FOUND');
  });

  test('cancels active provider subscriptions before deleting anything', async () => {
    process.env.LEMONSQUEEZY_API_KEY = 'test-key';
    listActiveByOrg.mockResolvedValueOnce([{ provider_subscription_id: 'sub_9' }]);
    const res = await deleteOrgs({ keep: ['org_keep'], apply: true });
    expect(cancelSubscription).toHaveBeenCalledWith('sub_9');
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.cancelled_subscriptions).toBe(1);
    delete process.env.LEMONSQUEEZY_API_KEY;
  });

  test('a dry run counts active subs but cancels none', async () => {
    listActiveByOrg.mockResolvedValueOnce([{ provider_subscription_id: 'sub_9' }]);
    const res = await deleteOrgs({ keep: ['org_keep'], apply: false });
    expect(cancelSubscription).not.toHaveBeenCalled();
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('expected ok');
    expect(res.data.active_subscriptions).toBe(1);
    expect(res.data.cancelled_subscriptions).toBe(0);
  });

  test('fails before deleting when an active sub exists but LEMONSQUEEZY_API_KEY is unset', async () => {
    listActiveByOrg.mockResolvedValueOnce([{ provider_subscription_id: 'sub_9' }]);
    const res = await deleteOrgs({ keep: ['org_keep'], apply: true });
    expect(deleteOrgById).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('expected failure');
    expect(res.error.code).toBe('SUB_CANCEL_FAILED');
  });

  test('requires exactly one of --org or --keep', async () => {
    for (const input of [{ apply: true }, { orgs: ['org_1'], keep: ['org_keep'], apply: true }]) {
      const res = await deleteOrgs(input);
      expect(res.ok).toBe(false);
      if (res.ok) throw new Error('expected failure');
      expect(res.error.code).toBe('BAD_TARGET');
    }
  });
});
