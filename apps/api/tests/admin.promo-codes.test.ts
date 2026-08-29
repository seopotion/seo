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

const { createDiscount, deleteDiscount } = vi.hoisted(() => ({
  createDiscount: vi.fn(),
  deleteDiscount: vi.fn(),
}));
vi.mock('../src/clients/billing', () => ({
  getBillingProvider: async () => ({ name: 'lemonsqueezy', createDiscount, deleteDiscount }),
}));

import { testClient } from 'hono/testing';
import adminApp, { type AdminAppType } from '../src/admin';
import { signAdminToken } from '../src/admin/jwt';

const client = testClient<AdminAppType>(adminApp);
const authed = async () => ({
  headers: { Authorization: `Bearer ${await signAdminToken('op@example.com')}` },
});

const promo = {
  id: 'p'.repeat(24),
  code: 'LAUNCH30',
  name: 'Launch promo',
  percent: 30,
  duration: 'repeating' as const,
  duration_in_months: 3,
  max_redemptions: 50,
  active: true,
  affiliate: 'jane',
  ls_discount_id: 'disc_1',
  created_at: new Date('2026-08-29T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  repos.AdminActionRepo.insert.mockResolvedValue({});
  repos.PromoRedemptionRepo.countConfirmed.mockResolvedValue(0);
});

describe('POST /admin/v0/promo-codes', () => {
  const body = {
    code: 'LAUNCH30',
    name: 'Launch promo',
    percent: 30,
    duration: 'repeating' as const,
    duration_in_months: 3,
    max_redemptions: 50,
    affiliate: 'jane',
  };

  test('creates the LS discount first, then the local doc; audits with org_id null', async () => {
    repos.PromoCodeRepo.findByCode.mockResolvedValueOnce(null);
    createDiscount.mockResolvedValueOnce({ providerDiscountId: 'disc_1' });
    repos.PromoCodeRepo.create.mockResolvedValueOnce(promo);

    const res = await client.admin.v0['promo-codes'].$post({ json: body }, await authed());
    if (res.status !== 201) throw new Error('expected 201');
    expect((await res.json()).promo_code).toMatchObject({
      code: 'LAUNCH30',
      confirmed_redemptions: 0,
      created_at: '2026-08-29T00:00:00.000Z',
    });
    expect(createDiscount).toHaveBeenCalledWith({
      name: 'Launch promo',
      code: 'LAUNCH30',
      percent: 30,
      duration: 'repeating',
      durationInMonths: 3,
      maxRedemptions: 50,
      expiresAt: undefined,
    });
    expect(repos.PromoCodeRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ ls_discount_id: 'disc_1', active: true, affiliate: 'jane' }),
    );
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'promo_code.create',
        org_id: null,
        entity: { type: 'promo_code', id: promo.id },
      }),
    );
  });

  test('generates a code when none is given', async () => {
    repos.PromoCodeRepo.findByCode.mockResolvedValueOnce(null);
    createDiscount.mockResolvedValueOnce({ providerDiscountId: 'disc_1' });
    repos.PromoCodeRepo.create.mockImplementationOnce(async (input) => ({
      ...promo,
      ...input,
      id: promo.id,
      created_at: promo.created_at,
    }));

    const { code: _c, ...noCode } = body;
    const res = await client.admin.v0['promo-codes'].$post({ json: noCode }, await authed());
    expect(res.status).toBe(201);
    const created = createDiscount.mock.calls[0]?.[0].code as string;
    expect(created).toMatch(/^[A-Z0-9]{8}$/);
  });

  test('409 code_exists before touching LS', async () => {
    repos.PromoCodeRepo.findByCode.mockResolvedValueOnce(promo);
    const res = await client.admin.v0['promo-codes'].$post({ json: body }, await authed());
    expect(res.status).toBe(409);
    expect(createDiscount).not.toHaveBeenCalled();
  });

  test('local insert failure best-effort deletes the LS discount and 500s (no audit)', async () => {
    repos.PromoCodeRepo.findByCode.mockResolvedValueOnce(null);
    createDiscount.mockResolvedValueOnce({ providerDiscountId: 'disc_1' });
    repos.PromoCodeRepo.create.mockRejectedValueOnce(new Error('mongo down'));

    const res = await client.admin.v0['promo-codes'].$post({ json: body }, await authed());
    expect(res.status).toBe(500);
    expect(deleteDiscount).toHaveBeenCalledWith('disc_1');
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });

  test('400 when duration_in_months is missing for repeating (zod refine, no defaultHook)', async () => {
    const { duration_in_months: _m, ...bad } = body;
    const res = await client.admin.v0['promo-codes'].$post({ json: bad }, await authed());
    expect(res.status).toBe(400);
  });
});

describe('GET /admin/v0/promo-codes', () => {
  test('lists codes with confirmed redemption counts', async () => {
    repos.PromoCodeRepo.list.mockResolvedValueOnce([promo]);
    repos.PromoRedemptionRepo.countConfirmed.mockResolvedValueOnce(7);
    const res = await client.admin.v0['promo-codes'].$get(undefined, await authed());
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).promo_codes[0]).toMatchObject({
      code: 'LAUNCH30',
      confirmed_redemptions: 7,
      affiliate: 'jane',
    });
  });
});

describe('GET /admin/v0/promo-codes/{id}/redemptions', () => {
  test('404 unknown code; 200 lists rows', async () => {
    repos.PromoCodeRepo.findById.mockResolvedValueOnce(null);
    const missing = await client.admin.v0['promo-codes'][':promo_code_id'].redemptions.$get(
      { param: { promo_code_id: 'x'.repeat(24) } },
      await authed(),
    );
    expect(missing.status).toBe(404);

    repos.PromoCodeRepo.findById.mockResolvedValueOnce(promo);
    repos.PromoRedemptionRepo.listByCode.mockResolvedValueOnce([
      {
        id: 'r'.repeat(24),
        code_id: promo.id,
        code: promo.code,
        org_id: 'o'.repeat(24),
        status: 'confirmed',
        created_at: new Date('2026-08-29T01:00:00.000Z'),
        confirmed_at: new Date('2026-08-29T02:00:00.000Z'),
      },
    ]);
    const res = await client.admin.v0['promo-codes'][':promo_code_id'].redemptions.$get(
      { param: { promo_code_id: promo.id } },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).redemptions[0]).toMatchObject({
      org_id: 'o'.repeat(24),
      status: 'confirmed',
      confirmed_at: '2026-08-29T02:00:00.000Z',
    });
  });
});

describe('POST /admin/v0/promo-codes/{id}/deactivate', () => {
  test('deletes the LS discount, flips active, audits with a before snapshot', async () => {
    repos.PromoCodeRepo.findById.mockResolvedValueOnce(promo);
    repos.PromoCodeRepo.deactivate.mockResolvedValueOnce({ ...promo, active: false });
    const res = await client.admin.v0['promo-codes'][':promo_code_id'].deactivate.$post(
      { param: { promo_code_id: promo.id } },
      await authed(),
    );
    if (res.status !== 200) throw new Error('expected 200');
    expect((await res.json()).promo_code.active).toBe(false);
    expect(deleteDiscount).toHaveBeenCalledWith('disc_1');
    expect(repos.AdminActionRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'promo_code.deactivate', before: promo }),
    );
  });

  test('404 unknown; 409 already inactive (no LS call, no audit)', async () => {
    repos.PromoCodeRepo.findById.mockResolvedValueOnce(null);
    const missing = await client.admin.v0['promo-codes'][':promo_code_id'].deactivate.$post(
      { param: { promo_code_id: 'x'.repeat(24) } },
      await authed(),
    );
    expect(missing.status).toBe(404);

    repos.PromoCodeRepo.findById.mockResolvedValueOnce({ ...promo, active: false });
    const res = await client.admin.v0['promo-codes'][':promo_code_id'].deactivate.$post(
      { param: { promo_code_id: promo.id } },
      await authed(),
    );
    expect(res.status).toBe(409);
    expect(deleteDiscount).not.toHaveBeenCalled();
    expect(repos.AdminActionRepo.insert).not.toHaveBeenCalled();
  });
});
