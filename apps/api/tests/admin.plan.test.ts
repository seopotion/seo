import { beforeEach, describe, expect, test, vi } from 'vitest';

const repos = vi.hoisted(() => ({
  OrgRepo: {
    findById: vi.fn(),
    search: vi.fn(),
    findByUserId: vi.fn(),
    setPlan: vi.fn(),
    claimStrategy: vi.fn(),
    setStrategyStatus: vi.fn(),
  },
  UserRepo: { findById: vi.fn(), findByEmail: vi.fn() },
  SubscriptionRepo: { findLatestByOrg: vi.fn(), listActiveByOrg: vi.fn() },
  GscConnectionRepo: { findByOrgId: vi.fn() },
  KeywordRepo: { countScheduled: vi.fn() },
  ArticleRepo: { countByStatus: vi.fn() },
  AdminActionRepo: { insert: vi.fn() },
  PromoCodeRepo: {
    create: vi.fn(),
    findByCode: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    deactivate: vi.fn(),
  },
  PromoRedemptionRepo: { countConfirmed: vi.fn(), listByCode: vi.fn() },
}));
vi.mock('@shared/db', () => repos);

const { enqueueScanTask } = vi.hoisted(() => ({ enqueueScanTask: vi.fn() }));
vi.mock('../src/clients/sqs', () => ({ enqueueScanTask }));

const { launchStrategy } = vi.hoisted(() => ({ launchStrategy: vi.fn() }));
vi.mock('@shared/strategy', () => ({ launchStrategy }));

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';

const client = testClient<AdminAppType>(adminApp);

const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
});

const baseOrg = {
  id: 'a'.repeat(24),
  user_id: 'u'.repeat(24),
  website_url: 'https://example.com',
  setup_status: 'setup_complete' as const,
  plan: 'free' as const,
  strategy_status: 'none' as const,
  presets: { business: { name: 'X' } }, // truthiness is what the kick checks
  created_at: new Date('2026-06-01T00:00:00.000Z'),
};

const setPlan = async (org_id: string, plan: 'free' | 'paid' | 'expert') =>
  client.admin.v0.orgs[':org_id'].plan.$post({ param: { org_id }, json: { plan } }, await authed());

beforeEach(() => {
  vi.clearAllMocks();
  repos.OrgRepo.setPlan.mockResolvedValue(true);
  repos.OrgRepo.claimStrategy.mockResolvedValue(true);
  repos.AdminActionRepo.insert.mockResolvedValue({});
  launchStrategy.mockResolvedValue({ run_id: 'run_1' });
});

describe('POST /admin/v0/orgs/{org_id}/plan', () => {
  test('sets the plan and kicks strategy when setup_complete + presets + paid + claim wins', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);

    const res = await setPlan(baseOrg.id, 'expert');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: 'expert', strategy_kicked: true });

    expect(repos.OrgRepo.setPlan).toHaveBeenCalledWith(baseOrg.id, 'expert');
    expect(repos.OrgRepo.claimStrategy).toHaveBeenCalledWith(baseOrg.id);
    expect(launchStrategy).toHaveBeenCalledWith(baseOrg.id);
  });

  test('writes one audit row with actor, action and a before snapshot', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);

    await setPlan(baseOrg.id, 'expert');

    expect(repos.AdminActionRepo.insert).toHaveBeenCalledTimes(1);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: 'op@example.com',
        action: 'org.set_plan',
        org_id: baseOrg.id,
        payload: { plan: 'expert' },
        before: baseOrg,
      }),
    );
  });

  test.each([
    [
      'org not setup_complete',
      { ...baseOrg, setup_status: 'setup_scan_completed' as const },
      'expert' as const,
    ],
    ['org has no presets', { ...baseOrg, presets: undefined }, 'expert' as const],
    ['new plan is free', baseOrg, 'free' as const],
  ])('no strategy kick when %s', async (_name, org, plan) => {
    repos.OrgRepo.findById.mockResolvedValueOnce(org);

    const res = await setPlan(org.id, plan);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan, strategy_kicked: false });
    expect(launchStrategy).not.toHaveBeenCalled();
  });

  test('no strategy kick when the claim loses', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);
    repos.OrgRepo.claimStrategy.mockResolvedValueOnce(false);

    const res = await setPlan(baseOrg.id, 'paid');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: 'paid', strategy_kicked: false });
    expect(launchStrategy).not.toHaveBeenCalled();
  });

  test('reverts the claim and rethrows on enqueue failure (and audits nothing)', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);
    launchStrategy.mockRejectedValueOnce(new Error('strategy launch failed'));

    const res = await setPlan(baseOrg.id, 'expert');
    expect(res.status).toBe(500);
    expect(repos.OrgRepo.setStrategyStatus).toHaveBeenCalledWith(baseOrg.id, 'failed');
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('unknown org -> 404 and no mutation, no audit row', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(null);

    const res = await setPlan('f'.repeat(24), 'expert');
    expect(res.status).toBe(404);
    expect(repos.OrgRepo.setPlan).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('audit-insert failure still returns the mutation success', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);
    repos.AdminActionRepo.insert.mockRejectedValueOnce(new Error('mongo down'));

    const res = await setPlan(baseOrg.id, 'expert');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: 'expert', strategy_kicked: true });
  });
});

describe('POST /admin/v0/orgs/{org_id}/strategy', () => {
  const runStrategy = async (org_id: string, force?: boolean) =>
    client.admin.v0.orgs[':org_id'].strategy.$post(
      { param: { org_id }, json: force === undefined ? {} : { force } },
      await authed(),
    );

  test('claim wins -> enqueue + audit + 200', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);

    const res = await runStrategy(baseOrg.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ strategy_status: 'pending' });
    expect(launchStrategy).toHaveBeenCalledWith(baseOrg.id);
    // Non-force never touches the status ahead of the claim.
    expect(repos.OrgRepo.setStrategyStatus).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.strategy_run', org_id: baseOrg.id }),
    );
  });

  test('claim refused (pending/completed) -> 409, no enqueue, no audit', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);
    repos.OrgRepo.claimStrategy.mockResolvedValueOnce(false);

    const res = await runStrategy(baseOrg.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'strategy_not_claimable' });
    expect(launchStrategy).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('enqueue failure reverts the claim and 500s', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);
    launchStrategy.mockRejectedValueOnce(new Error('strategy launch failed'));

    const res = await runStrategy(baseOrg.id);
    expect(res.status).toBe(500);
    expect(repos.OrgRepo.setStrategyStatus).toHaveBeenCalledWith(baseOrg.id, 'failed');
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('force: true resets a completed strategy before claiming, audits the force action', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce({
      ...baseOrg,
      strategy_status: 'completed' as const,
    });

    const res = await runStrategy(baseOrg.id, true);
    expect(res.status).toBe(200);
    // Reset happens BEFORE the claim (claimStrategy only claims none|failed).
    const resetOrder = repos.OrgRepo.setStrategyStatus.mock.invocationCallOrder[0] ?? 0;
    const claimOrder = repos.OrgRepo.claimStrategy.mock.invocationCallOrder[0] ?? 0;
    expect(repos.OrgRepo.setStrategyStatus).toHaveBeenCalledWith(baseOrg.id, 'failed');
    expect(resetOrder).toBeLessThan(claimOrder);
    expect(launchStrategy).toHaveBeenCalledWith(baseOrg.id);
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.strategy_force_rerun', payload: { force: true } }),
    );
  });

  test('force: false behaves as a plain run', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg);

    const res = await runStrategy(baseOrg.id, false);
    expect(res.status).toBe(200);
    expect(repos.OrgRepo.setStrategyStatus).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.strategy_run' }),
    );
  });
});

describe('POST /admin/v0/orgs/{org_id}/scan', () => {
  const rerunScan = async (org_id: string) =>
    client.admin.v0.orgs[':org_id'].scan.$post({ param: { org_id } }, await authed());

  test('setup_complete org -> hard 409, nothing enqueued, no audit', async () => {
    repos.OrgRepo.findById.mockResolvedValueOnce(baseOrg); // setup_complete
    const res = await rerunScan(baseOrg.id);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'setup_complete' });
    expect(enqueueScanTask).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('stuck onboarding org -> re-enqueues the scan and audits', async () => {
    const stuck = { ...baseOrg, setup_status: 'setup_scan_in_progress' as const };
    repos.OrgRepo.findById.mockResolvedValueOnce(stuck);

    const res = await rerunScan(stuck.id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enqueued: true });
    expect(enqueueScanTask).toHaveBeenCalledWith({
      org_id: stuck.id,
      website_url: stuck.website_url,
    });
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'org.scan_rerun', before: stuck }),
    );
  });
});
