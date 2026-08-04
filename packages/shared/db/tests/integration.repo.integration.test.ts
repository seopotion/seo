import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { IntegrationRepo } from '../src/repositories/integration.repo';

/**
 * Real-MongoDB round-trip (#7). Run with `npm run test:integration` after
 * `docker compose up -d mongo`. Proves the Zod `parse` boundary through the
 * discriminated union, the upsert, and both unique indexes.
 */
describe('IntegrationRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('integrations').deleteMany({});
    await ensureIndexes();
  });

  afterAll(async () => {
    await closeDb();
  });

  test('connectWordPress round-trips through the union', async () => {
    await IntegrationRepo.connectWordPress('org_wp', 'https://clewas.com', 'ciphertext');

    const found = await IntegrationRepo.findByOrgAndProvider('org_wp', 'wordpress');
    expect(found?.id).toMatch(/^[a-f0-9]{24}$/);
    expect(found?.provider).toBe('wordpress');
    // Narrowing only kicks in on a provider-specific field — that is the point
    // of the flat union.
    if (found?.provider === 'wordpress') expect(found.token_enc).toBe('ciphertext');
    expect(found?.connected_at).toBeInstanceOf(Date);
    expect(found?.last_error).toBeNull();
  });

  test('reconnecting replaces the token instead of adding a second row', async () => {
    await IntegrationRepo.connectWordPress('org_re', 'https://a.com', 'first');
    await IntegrationRepo.connectWordPress('org_re', 'https://b.com', 'second');

    const rows = await IntegrationRepo.listByOrgId('org_re');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider === 'wordpress' && rows[0].token_enc).toBe('second');
  });

  test('the unique index rejects a second row for one (org, provider)', async () => {
    const col = (await getDb()).collection('integrations');
    await IntegrationRepo.connectWordPress('org_dup', 'https://dup.com', 'x');

    await expect(
      col.insertOne({
        org_id: 'org_dup',
        provider: 'wordpress',
        site_url: 'https://dup.com',
        token_enc: 'y',
        connected_at: new Date(),
        last_error: null,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  test('one GitHub installation cannot bind to two orgs', async () => {
    const col = (await getDb()).collection('integrations');
    const row = (orgId: string) => ({
      org_id: orgId,
      provider: 'static-site',
      host: 'github',
      installation_id: 987654,
      repo: 'acme/site',
      branch: 'main',
      content_path: 'seopotion/',
      connected_at: new Date(),
      last_error: null,
    });
    await col.insertOne(row('org_gh_1'));

    // The claim-someone-else's-installation hole, closed at the database layer
    // (design/github-app.md § Why `state` is not optional here).
    await expect(col.insertOne(row('org_gh_2'))).rejects.toMatchObject({ code: 11000 });
  });

  test('connectStaticSite round-trips through the union', async () => {
    expect(
      await IntegrationRepo.connectStaticSite('org_ss', {
        installationId: 111222,
        repo: 'unmarble/unmarble-website',
        branch: 'main',
        contentPath: 'seopotion/',
      }),
    ).toBe(true);

    const found = await IntegrationRepo.findByOrgAndProvider('org_ss', 'static-site');
    expect(found?.provider).toBe('static-site');
    if (found?.provider !== 'static-site') return;
    expect(found.host).toBe('github');
    expect(found.installation_id).toBe(111222);
    expect(found.repo).toBe('unmarble/unmarble-website');
    expect(found.content_path).toBe('seopotion/');
    // No secret at rest: only the installation id, which mints ~1h tokens.
    expect(Object.keys(found)).not.toContain('token_enc');
  });

  test('reconnecting the same org repoints the row instead of adding one', async () => {
    await IntegrationRepo.connectStaticSite('org_ss_re', {
      installationId: 333444,
      repo: 'acme/site',
      branch: 'main',
      contentPath: 'seopotion/',
    });
    await IntegrationRepo.connectStaticSite('org_ss_re', {
      installationId: 333444,
      repo: 'acme/site',
      branch: 'release',
      contentPath: 'content/',
    });

    const rows = await IntegrationRepo.listByOrgId('org_ss_re');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.provider === 'static-site' && rows[0].branch).toBe('release');
  });

  test('connectStaticSite returns false for an installation another org already claimed', async () => {
    await IntegrationRepo.connectStaticSite('org_claim_1', {
      installationId: 555666,
      repo: 'acme/site',
      branch: 'main',
      contentPath: 'seopotion/',
    });

    // The partial unique index is what says no, so two simultaneous claimants
    // cannot both pass a check-then-write.
    expect(
      await IntegrationRepo.connectStaticSite('org_claim_2', {
        installationId: 555666,
        repo: 'acme/site',
        branch: 'main',
        contentPath: 'seopotion/',
      }),
    ).toBe(false);
    expect(await IntegrationRepo.listByOrgId('org_claim_2')).toEqual([]);
  });

  test('the installation index is partial — WordPress rows never collide on it', async () => {
    // Both lack installation_id; a non-partial unique index would reject the
    // second on null.
    await IntegrationRepo.connectWordPress('org_p1', 'https://p1.com', 'a');
    await IntegrationRepo.connectWordPress('org_p2', 'https://p2.com', 'b');

    expect(await IntegrationRepo.findByOrgAndProvider('org_p2', 'wordpress')).not.toBeNull();
  });

  test('deleteByOrgAndProvider reports whether a row matched', async () => {
    await IntegrationRepo.connectWordPress('org_del', 'https://del.com', 'x');

    expect(await IntegrationRepo.deleteByOrgAndProvider('org_del', 'wordpress')).toBe(true);
    expect(await IntegrationRepo.deleteByOrgAndProvider('org_del', 'wordpress')).toBe(false);
    expect(await IntegrationRepo.listByOrgId('org_del')).toEqual([]);
  });
});
