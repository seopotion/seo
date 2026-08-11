import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { GscAnalyticsCacheRepo } from '../src/repositories/gsc-analytics-cache.repo';

/**
 * Real-MongoDB round-trip for GscAnalyticsCacheRepo (#208). Run with
 * `npm run test:integration` after `docker compose up -d mongo`.
 */
describe('GscAnalyticsCacheRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('gsc_analytics_cache').deleteMany({});
  });

  afterAll(async () => {
    await closeDb();
  });

  const rows = [{ keys: ['2026-08-01'], clicks: 10, impressions: 200, ctr: 0.05, position: 7.5 }];

  test('get returns null on a miss', async () => {
    expect(await GscAnalyticsCacheRepo.get('missing')).toBeNull();
  });

  test('put stores rows and get returns them', async () => {
    await GscAnalyticsCacheRepo.put('key-1', 'org_a', rows);
    expect(await GscAnalyticsCacheRepo.get('key-1')).toEqual(rows);
  });

  test('put upserts — same key replaces rows, no duplicate', async () => {
    const updated = [
      { keys: ['2026-08-02'], clicks: 3, impressions: 50, ctr: 0.06, position: 4.1 },
    ];
    await GscAnalyticsCacheRepo.put('key-1', 'org_a', updated);
    expect(await GscAnalyticsCacheRepo.get('key-1')).toEqual(updated);
    const count = await (await getDb()).collection('gsc_analytics_cache').countDocuments({});
    expect(count).toBe(1);
  });

  test('an empty rows array is a valid cached value, not a miss', async () => {
    await GscAnalyticsCacheRepo.put('key-empty', 'org_a', []);
    expect(await GscAnalyticsCacheRepo.get('key-empty')).toEqual([]);
  });
});
