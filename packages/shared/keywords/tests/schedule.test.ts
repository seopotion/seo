import { describe, expect, test } from 'vitest';
import { stampScheduledDates } from '../src/schedule';

const item = (id: number, type: string) => ({ id, article_type: type });

describe('stampScheduledDates', () => {
  test('preserves input order and assigns consecutive UTC dates', () => {
    const input = [item(1, 'same'), item(2, 'same'), item(3, 'different')];
    const out = stampScheduledDates(input, new Date('2026-07-08T23:00:00-07:00'), 30);

    expect(out.map((entry) => entry.item.id)).toEqual([1, 2, 3]);
    expect(out.map((entry) => entry.scheduled_date)).toEqual([
      '2026-07-09',
      '2026-07-10',
      '2026-07-11',
    ]);
    expect(out[0]!.item).toBe(input[0]);
    expect(input).toEqual([item(1, 'same'), item(2, 'same'), item(3, 'different')]);
  });

  test('caps without padding', () => {
    const out = stampScheduledDates(
      [item(1, 'a'), item(2, 'b')],
      new Date('2026-07-08T00:00:00Z'),
      1,
    );
    expect(out).toEqual([{ item: { id: 1, article_type: 'a' }, scheduled_date: '2026-07-08' }]);
    expect(stampScheduledDates([item(1, 'a')], new Date('2026-07-08T00:00:00Z'), 3)).toHaveLength(
      1,
    );
  });

  test.each([-1, 1.5, Number.NaN])('rejects invalid days %s', (days) => {
    expect(() => stampScheduledDates([], new Date('2026-07-08T00:00:00Z'), days)).toThrow(
      /days must be a non-negative integer/i,
    );
  });
});
