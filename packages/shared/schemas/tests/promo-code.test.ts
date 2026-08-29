import { describe, expect, test } from 'vitest';
import { PromoCodeSchema, PromoRedemptionSchema } from '../src';

const base = {
  id: 'a'.repeat(24),
  code: 'LAUNCH30',
  name: 'Launch promo',
  percent: 30,
  duration: 'repeating' as const,
  duration_in_months: 3,
  active: true,
  ls_discount_id: 'disc_1',
  created_at: new Date('2026-08-29T00:00:00Z'),
};

describe('PromoCodeSchema', () => {
  test('accepts a repeating code with months', () => {
    expect(PromoCodeSchema.parse(base).code).toBe('LAUNCH30');
  });

  test('accepts forever/once codes without months, optional fields absent', () => {
    const { duration_in_months: _m, ...rest } = base;
    expect(PromoCodeSchema.parse({ ...rest, duration: 'forever' }).duration).toBe('forever');
    expect(PromoCodeSchema.parse({ ...rest, duration: 'once' }).duration).toBe('once');
  });

  test('rejects repeating without months and non-repeating with months', () => {
    const { duration_in_months: _m, ...rest } = base;
    expect(PromoCodeSchema.safeParse({ ...rest, duration: 'repeating' }).success).toBe(false);
    expect(
      PromoCodeSchema.safeParse({ ...base, duration: 'forever', duration_in_months: 3 }).success,
    ).toBe(false);
  });

  test.each([
    'launch30',
    'AB',
    'HAS SPACE',
    'HAS-DASH',
    'X'.repeat(33),
  ])('rejects malformed code %s', (code) => {
    expect(PromoCodeSchema.safeParse({ ...base, code }).success).toBe(false);
  });

  test.each([0, 101, 30.5])('rejects percent %s', (percent) => {
    expect(PromoCodeSchema.safeParse({ ...base, percent }).success).toBe(false);
  });
});

describe('PromoRedemptionSchema', () => {
  test('parses pending and confirmed rows', () => {
    const row = {
      id: 'b'.repeat(24),
      code_id: base.id,
      code: 'LAUNCH30',
      org_id: 'c'.repeat(24),
      status: 'pending' as const,
      created_at: new Date('2026-08-29T00:00:00Z'),
    };
    expect(PromoRedemptionSchema.parse(row).status).toBe('pending');
    expect(
      PromoRedemptionSchema.parse({
        ...row,
        status: 'confirmed',
        confirmed_at: new Date('2026-08-30T00:00:00Z'),
      }).confirmed_at,
    ).toBeInstanceOf(Date);
  });
});
