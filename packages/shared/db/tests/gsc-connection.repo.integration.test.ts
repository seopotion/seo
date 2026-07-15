import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { GscConnectionRepo } from '../src/repositories/gsc-connection.repo';

/**
 * Real-MongoDB round-trip for GscConnectionRepo. Run with
 * `npm run test:integration` after `docker compose up -d mongo`.
 */
describe('GscConnectionRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('gsc_connections').deleteMany({});
  });

  afterAll(async () => {
    await closeDb();
  });

  test('upsertToken creates a pending connection (site_url null)', async () => {
    await GscConnectionRepo.upsertToken('org_a', 'enc-1', 'a@x.com');

    const conn = await GscConnectionRepo.findByOrgId('org_a');
    expect(conn?.refresh_token_enc).toBe('enc-1');
    expect(conn?.site_url).toBeNull();
    expect(conn?.last_refresh_failed_at).toBeNull();
  });

  test('upsertToken replaces the token and resets state on reconnect', async () => {
    await GscConnectionRepo.setSiteUrl('org_a', 'sc-domain:a.com');
    await GscConnectionRepo.markRefreshFailed('org_a');

    await GscConnectionRepo.upsertToken('org_a', 'enc-2', 'a@x.com');

    const conn = await GscConnectionRepo.findByOrgId('org_a');
    expect(conn?.refresh_token_enc).toBe('enc-2');
    expect(conn?.site_url).toBeNull();
    expect(conn?.last_refresh_failed_at).toBeNull();
  });

  test('setSiteUrl finalizes and markRefreshFailed stamps a date', async () => {
    await GscConnectionRepo.setSiteUrl('org_a', 'sc-domain:a.com');
    expect((await GscConnectionRepo.findByOrgId('org_a'))?.site_url).toBe('sc-domain:a.com');

    await GscConnectionRepo.markRefreshFailed('org_a');
    expect(
      (await GscConnectionRepo.findByOrgId('org_a'))?.last_refresh_failed_at,
    ).toBeInstanceOf(Date);
  });

  test('deleteByOrgId removes the row and reports it', async () => {
    expect(await GscConnectionRepo.deleteByOrgId('org_a')).toBe(true);
    expect(await GscConnectionRepo.findByOrgId('org_a')).toBeNull();
    expect(await GscConnectionRepo.deleteByOrgId('org_a')).toBe(false);
  });
});
