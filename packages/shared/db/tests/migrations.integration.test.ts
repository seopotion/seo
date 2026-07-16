import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { runMigrations } from '../src/migrations';

/**
 * Real-MongoDB migration round-trip. Run with `npm run test:integration`
 * after `docker compose up -d mongo`.
 */
describe('runMigrations (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('orgs').deleteMany({ website_url: /migration-test/ });
    await db.collection('orgs').insertMany([
      {
        website_url: 'https://migration-test-string.example',
        presets: { audience: { target: 'plant operators, and managers', competitors: [] } },
      },
      {
        website_url: 'https://migration-test-empty.example',
        presets: { audience: { target: '', competitors: [] } },
      },
      {
        website_url: 'https://migration-test-array.example',
        presets: { audience: { target: ['z'], competitors: [] } },
      },
      { website_url: 'https://migration-test-nopresets.example' },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('orgs').deleteMany({ website_url: /migration-test/ });
    await closeDb();
  });

  test('converts string targets to arrays without comma-splitting', async () => {
    const report = await runMigrations();
    // >= because the shared local DB may hold other legacy-string orgs.
    expect(report.audience_target_migrated).toBeGreaterThanOrEqual(2);

    const db = await getDb();
    const byUrl = async (url: string) =>
      db.collection('orgs').findOne({ website_url: `https://migration-test-${url}.example` });

    expect((await byUrl('string'))?.presets.audience.target).toEqual([
      'plant operators, and managers',
    ]);
    expect((await byUrl('empty'))?.presets.audience.target).toEqual([]);
    expect((await byUrl('array'))?.presets.audience.target).toEqual(['z']);
    expect((await byUrl('nopresets'))?.presets).toBeUndefined();
  });

  test('is idempotent: a second run changes nothing', async () => {
    const report = await runMigrations();
    expect(report.audience_target_migrated).toBe(0);
  });
});
