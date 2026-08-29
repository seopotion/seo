import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { PromoCodeRepo } from '../src/repositories/promo-code.repo';
import { PromoRedemptionRepo } from '../src/repositories/promo-redemption.repo';

const codeInput = (over: Record<string, unknown> = {}) => ({
  code: 'LAUNCH30',
  name: 'Launch promo',
  percent: 30,
  duration: 'repeating' as const,
  duration_in_months: 3,
  active: true,
  ls_discount_id: 'disc_1',
  ...over,
});

describe('Promo repos (integration)', () => {
  beforeAll(async () => {
    await ensureIndexes();
    const db = await getDb();
    await db.collection('promo_codes').deleteMany({});
    await db.collection('promo_redemptions').deleteMany({});
  });
  afterAll(async () => {
    await closeDb();
  });

  test('create + findByCode + duplicate code rejected by the unique index', async () => {
    const created = await PromoCodeRepo.create(codeInput());
    expect(created.id).toMatch(/^[a-f0-9]{24}$/);
    expect((await PromoCodeRepo.findByCode('LAUNCH30'))?.id).toBe(created.id);
    await expect(PromoCodeRepo.create(codeInput({ ls_discount_id: 'disc_2' }))).rejects.toThrow();
  });

  test('list is newest-first; deactivate flips active and keeps the row', async () => {
    const second = await PromoCodeRepo.create(
      codeInput({
        code: 'TEAMFREE',
        percent: 100,
        duration: 'forever',
        duration_in_months: undefined,
      }),
    );
    const listed = await PromoCodeRepo.list();
    expect(listed.map((p) => p.code)).toEqual(['TEAMFREE', 'LAUNCH30']);
    const off = await PromoCodeRepo.deactivate(second.id);
    expect(off?.active).toBe(false);
    expect((await PromoCodeRepo.findByCode('TEAMFREE'))?.active).toBe(false);
  });

  test('upsertPending is idempotent per (code, org); confirm flips pending rows only', async () => {
    const promo = await PromoCodeRepo.findByCode('LAUNCH30');
    if (!promo) throw new Error('setup failed');
    await PromoRedemptionRepo.upsertPending(promo.id, promo.code, 'org1');
    await PromoRedemptionRepo.upsertPending(promo.id, promo.code, 'org1'); // abandoned checkout retried
    const db = await getDb();
    expect(await db.collection('promo_redemptions').countDocuments({})).toBe(1);

    expect(await PromoRedemptionRepo.confirmPendingByOrg('org1')).toBe(1);
    expect(await PromoRedemptionRepo.countConfirmed(promo.id)).toBe(1);
    const confirmed = await PromoRedemptionRepo.findConfirmedByCodeAndOrg(promo.id, 'org1');
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.confirmed_at).toBeInstanceOf(Date);

    // A confirmed row must never be demoted back to pending.
    await PromoRedemptionRepo.upsertPending(promo.id, promo.code, 'org1');
    expect((await PromoRedemptionRepo.findConfirmedByCodeAndOrg(promo.id, 'org1'))?.status).toBe(
      'confirmed',
    );
    expect(await db.collection('promo_redemptions').countDocuments({})).toBe(1);
  });

  test('confirmPendingByOrg with nothing pending returns 0; listByCode returns rows', async () => {
    expect(await PromoRedemptionRepo.confirmPendingByOrg('org-none')).toBe(0);
    const promo = await PromoCodeRepo.findByCode('LAUNCH30');
    if (!promo) throw new Error('setup failed');
    expect((await PromoRedemptionRepo.listByCode(promo.id)).length).toBe(1);
  });
});
