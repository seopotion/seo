import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { OrgRepo } from '../src/repositories/org.repo';

/**
 * Real-MongoDB round-trip. Run with `npm run test:integration` after
 * `docker compose up -d mongo`. Proves the Zod `parse` boundary, the
 * `_id` <-> `id` mapping, and updateStatus against a live driver.
 */
describe('OrgRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('orgs').deleteMany({});
  });

  afterAll(async () => {
    await closeDb();
  });

  test('create + findById round-trips through Zod', async () => {
    const org = await OrgRepo.create({
      user_id: 'user_1',
      website_url: 'https://example.com',
      setup_status: 'setup_scan_in_progress',
    });
    expect(org.id).toMatch(/^[a-f0-9]{24}$/);

    const found = await OrgRepo.findById(org.id);
    expect(found?.website_url).toBe('https://example.com');
    expect(found?.created_at).toBeInstanceOf(Date);
  });

  test('updateStatus advances the status', async () => {
    const org = await OrgRepo.create({
      user_id: 'user_1',
      website_url: 'https://other.com',
      setup_status: 'setup_scan_in_progress',
    });
    await OrgRepo.updateStatus(org.id, 'setup_scan_completed');

    const found = await OrgRepo.findById(org.id);
    expect(found?.setup_status).toBe('setup_scan_completed');
  });

  test('findById returns null for an invalid id', async () => {
    expect(await OrgRepo.findById('not-an-objectid')).toBeNull();
  });
});
