import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { runMigrations } from '../src/migrations';

const MIG_ORG = 'org_migration_test';

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

describe('runMigrations keyword invariants (#99, integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({ org_id: MIG_ORG });
    // Restore the pre-#99 index state so the seeded anomalies can exist and
    // ensureIndexes must convert/create the unique indexes.
    const indexes = await db.collection('keywords').indexes();
    for (const name of [
      'org_id_1_scheduled_date_1',
      'org_id_1_normalized_keyword_1',
      'org_id_1_candidate_id_1',
    ]) {
      if (indexes.some((i) => i.name === name)) {
        await db.collection('keywords').dropIndex(name);
      }
    }
    await db.collection('keywords').createIndex({ org_id: 1, scheduled_date: 1 });

    const base = { org_id: MIG_ORG, status: 'scheduled', search_volume: 10, difficulty: 10 };
    await db.collection('keywords').insertMany([
      // Missing normalized_keyword (legacy) + date duplicate with the next one.
      { ...base, keyword: 'Alpha  One', scheduled_date: '2026-08-01', article_id: null },
      {
        ...base,
        keyword: 'beta two',
        normalized_keyword: 'beta two',
        scheduled_date: '2026-08-01',
        article_id: 'art_1', // article-linked entry keeps the contested date
      },
      // Normalized duplicate pair: unlinked extra must be deleted.
      {
        ...base,
        keyword: 'gamma three',
        normalized_keyword: 'gamma three',
        scheduled_date: '2026-08-03',
        article_id: 'art_2',
      },
      {
        ...base,
        keyword: 'Gamma Three',
        normalized_keyword: 'gamma three',
        scheduled_date: '2026-08-04',
        article_id: null,
      },
    ]);
  });

  afterAll(async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({ org_id: MIG_ORG });
  });

  test('backfills normalized_keyword, shifts date dupes, removes keyword dupes', async () => {
    const report = await runMigrations();
    expect(report.normalized_backfilled).toBeGreaterThanOrEqual(1);
    expect(report.date_dupes_resolved).toBeGreaterThanOrEqual(1);
    expect(report.keyword_dupes_removed).toBeGreaterThanOrEqual(1);

    const db = await getDb();
    const docs = await db.collection('keywords').find({ org_id: MIG_ORG }).toArray();

    const alpha = docs.find((d) => d.keyword === 'Alpha  One');
    expect(alpha?.normalized_keyword).toBe('alpha one');
    // Article-linked doc kept 2026-08-01; the unlinked dupe moved to a free day.
    const beta = docs.find((d) => d.keyword === 'beta two');
    expect(beta?.scheduled_date).toBe('2026-08-01');
    expect(alpha?.scheduled_date).not.toBe('2026-08-01');

    // Normalized dupes: only the article-linked gamma survives.
    const gammas = docs.filter((d) => d.normalized_keyword === 'gamma three');
    expect(gammas).toHaveLength(1);
    expect(gammas[0]!.article_id).toBe('art_2');
  });

  test('ensureIndexes converts the date index to unique and adds the new ones', async () => {
    await ensureIndexes();
    const db = await getDb();
    const indexes = await db.collection('keywords').indexes();
    expect(indexes.find((i) => i.name === 'org_id_1_scheduled_date_1')?.unique).toBe(true);
    expect(indexes.find((i) => i.name === 'org_id_1_normalized_keyword_1')?.unique).toBe(true);
    expect(indexes.find((i) => i.name === 'org_id_1_candidate_id_1')?.unique).toBe(true);
  });

  test('second run is a no-op', async () => {
    const report = await runMigrations();
    expect(report.normalized_backfilled).toBe(0);
    expect(report.date_dupes_resolved).toBe(0);
    expect(report.keyword_dupes_removed).toBe(0);
  });
});
