import { describe, expect, test } from 'vitest';
import { clusterSpreadSchedule } from '../src/schedule';

const item = (id: number, type: string) => ({ id, article_type: type });

describe('clusterSpreadSchedule', () => {
  test('assigns consecutive dates from the start date', () => {
    const out = clusterSpreadSchedule(
      [item(1, 'a'), item(2, 'b')],
      new Date('2026-07-08T00:00:00Z'),
      30,
    );
    expect(out.map((o) => o.scheduled_date)).toEqual(['2026-07-08', '2026-07-09']);
  });

  test('interleaves clusters so no two adjacent days share a type when possible', () => {
    const items = [item(1, 'a'), item(2, 'a'), item(3, 'b'), item(4, 'b')];
    const out = clusterSpreadSchedule(items, new Date('2026-07-08T00:00:00Z'), 30);
    const types = out.map((o) => o.article_type);
    for (let i = 1; i < types.length; i++) expect(types[i]).not.toBe(types[i - 1]);
  });

  test('is deterministic', () => {
    const items = [item(1, 'a'), item(2, 'b'), item(3, 'a')];
    const a = clusterSpreadSchedule(items, new Date('2026-07-08T00:00:00Z'));
    const b = clusterSpreadSchedule(items, new Date('2026-07-08T00:00:00Z'));
    expect(a).toEqual(b);
  });
});
