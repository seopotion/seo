import { ObjectId } from 'mongodb';
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

  test('saveWordPressConnection stores the token and timestamp on the org', async () => {
    const org = await OrgRepo.create({
      user_id: 'user_1',
      website_url: 'https://wordpress.com',
      setup_status: 'setup_complete',
    });
    const connectedAt = new Date('2026-07-14T10:00:00.000Z');

    await OrgRepo.saveWordPressConnection(org.id, 'wordpress-token', connectedAt);

    const found = await OrgRepo.findById(org.id);
    expect(found?.wordpress_token).toBe('wordpress-token');
    expect(found?.wordpress_connected_at).toEqual(connectedAt);
  });

  test('findById returns null for an invalid id', async () => {
    expect(await OrgRepo.findById('not-an-objectid')).toBeNull();
  });

  test('setPlan flips the entitlement plan and reports the match', async () => {
    const org = await OrgRepo.create({
      user_id: 'user_1',
      website_url: 'https://plan.com',
      setup_status: 'setup_scan_in_progress',
    });
    expect(org.plan).toBe('free');

    const matched = await OrgRepo.setPlan(org.id, 'paid');
    expect(matched).toBe(true);

    const found = await OrgRepo.findById(org.id);
    expect(found?.plan).toBe('paid');
  });

  test('setPlan returns false when no org matches', async () => {
    expect(await OrgRepo.setPlan(new ObjectId().toString(), 'paid')).toBe(false);
    expect(await OrgRepo.setPlan('not-an-objectid', 'paid')).toBe(false);
  });

  test('updateDomainRating stores value + checked_at, readable via findById', async () => {
    const org = await OrgRepo.create({
      user_id: 'user_dr',
      website_url: 'https://dr.example.com',
      setup_status: 'setup_scan_in_progress',
    });

    await OrgRepo.updateDomainRating(org.id, 42);

    const found = await OrgRepo.findById(org.id);
    expect(found?.domain_rating?.value).toBe(42);
    expect(found?.domain_rating?.checked_at).toBeInstanceOf(Date);
  });

  test('search by org id returns a 0/1-element array', async () => {
    const org = await OrgRepo.create({
      user_id: 'user_search',
      website_url: 'https://search-by-id.example.com',
      setup_status: 'setup_scan_in_progress',
    });

    const hit = await OrgRepo.search(org.id);
    expect(hit).toHaveLength(1);
    expect(hit[0]?.id).toBe(org.id);

    expect(await OrgRepo.search(new ObjectId().toString())).toEqual([]);
  });

  test('search matches website_url substrings case-insensitively', async () => {
    await OrgRepo.create({
      user_id: 'user_search',
      website_url: 'https://Unique-Widgets.example.com',
      setup_status: 'setup_scan_in_progress',
    });

    const found = await OrgRepo.search('unique-widgets');
    expect(found).toHaveLength(1);
    expect(found[0]?.website_url).toBe('https://Unique-Widgets.example.com');
  });

  test('search escapes regex metacharacters (no throw, no wildcard match)', async () => {
    await OrgRepo.create({
      user_id: 'user_search',
      website_url: 'https://dotted.example.com',
      setup_status: 'setup_scan_in_progress',
    });

    // '.' must be literal: 'dotted.example' matches, 'dottedXexample' must not.
    expect((await OrgRepo.search('dotted.example')).length).toBe(1);
    expect(await OrgRepo.search('dotted.example'.replace('.', 'X'))).toEqual([]);
    expect(await OrgRepo.search('d.tted')).toEqual([]);
    // Unbalanced metacharacters must not throw.
    expect(await OrgRepo.search('a(b[c')).toEqual([]);
    expect(await OrgRepo.search('.*')).toEqual([]);
  });
});
