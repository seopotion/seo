import { ObjectId } from 'mongodb';
import { afterAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ArticleRepo } from '../src/repositories/article.repo';
import { CandidateRepo } from '../src/repositories/candidate.repo';
import { GscAnalyticsCacheRepo } from '../src/repositories/gsc-analytics-cache.repo';
import { IntegrationRepo } from '../src/repositories/integration.repo';
import { KeywordRepo } from '../src/repositories/keyword.repo';
import { OrgRepo } from '../src/repositories/org.repo';
import { StrategyRunRepo } from '../src/repositories/strategy-run.repo';

/**
 * Real-MongoDB round-trip for the `db reset-user` delete methods. Run with
 * `npm run test:integration` after `docker compose up -d mongo`. Fixtures are
 * raw inserts scoped to unique org ids: deleteByOrgId matches on org_id only,
 * so full valid entities aren't needed and other test files stay untouched.
 */
describe('delete-by-org (integration)', () => {
  const timestamp = Date.now();

  afterAll(async () => {
    await closeDb();
  });

  test("KeywordRepo.deleteByOrgId removes only that org's keywords", async () => {
    const col = (await getDb()).collection('keywords');
    const orgA = `reset_kw_a_${timestamp}`;
    const orgB = `reset_kw_b_${timestamp}`;
    // Distinct dates: keywords carry a unique (org_id, scheduled_date) index (#99).
    await col.insertMany([
      { org_id: orgA, keyword: 'k1', scheduled_date: '2026-07-01' },
      { org_id: orgA, keyword: 'k2', scheduled_date: '2026-07-02' },
      { org_id: orgB, keyword: 'k3', scheduled_date: '2026-07-01' },
    ]);

    expect(await KeywordRepo.deleteByOrgId(orgA)).toBe(2);
    expect(await col.countDocuments({ org_id: orgA })).toBe(0);
    expect(await col.countDocuments({ org_id: orgB })).toBe(1);
  });

  test("CandidateRepo.deleteByOrgId removes only that org's candidates", async () => {
    const col = (await getDb()).collection('candidates');
    const orgA = `reset_cand_a_${timestamp}`;
    const orgB = `reset_cand_b_${timestamp}`;
    await col.insertMany([
      { org_id: orgA, normalized_keyword: 'c1', keyword: 'c1' },
      { org_id: orgB, normalized_keyword: 'c2', keyword: 'c2' },
    ]);

    expect(await CandidateRepo.deleteByOrgId(orgA)).toBe(1);
    expect(await col.countDocuments({ org_id: orgA })).toBe(0);
    expect(await col.countDocuments({ org_id: orgB })).toBe(1);
  });

  test("ArticleRepo.deleteByOrgId removes only that org's articles", async () => {
    const col = (await getDb()).collection('articles');
    const orgA = `reset_art_a_${timestamp}`;
    const orgB = `reset_art_b_${timestamp}`;
    await col.insertMany([
      { org_id: orgA, title: 'a1' },
      { org_id: orgB, title: 'a2' },
    ]);

    expect(await ArticleRepo.deleteByOrgId(orgA)).toBe(1);
    expect(await col.countDocuments({ org_id: orgA })).toBe(0);
    expect(await col.countDocuments({ org_id: orgB })).toBe(1);
  });

  test("IntegrationRepo.deleteByOrgId removes only that org's providers", async () => {
    const col = (await getDb()).collection('integrations');
    const orgA = `reset_int_a_${timestamp}`;
    const orgB = `reset_int_b_${timestamp}`;
    await col.insertMany([
      { org_id: orgA, provider: 'wordpress' },
      { org_id: orgA, provider: 'static-site' },
      { org_id: orgB, provider: 'wordpress' },
    ]);

    expect(await IntegrationRepo.deleteByOrgId(orgA)).toBe(2);
    expect(await col.countDocuments({ org_id: orgA })).toBe(0);
    expect(await col.countDocuments({ org_id: orgB })).toBe(1);
  });

  test("StrategyRunRepo.deleteByOrgId removes only that org's runs", async () => {
    const col = (await getDb()).collection('strategy_runs');
    const orgA = `reset_run_a_${timestamp}`;
    const orgB = `reset_run_b_${timestamp}`;
    await col.insertMany([
      { org_id: orgA, status: 'failed' },
      { org_id: orgA, status: 'completed' },
      { org_id: orgB, status: 'completed' },
    ]);

    expect(await StrategyRunRepo.deleteByOrgId(orgA)).toBe(2);
    expect(await col.countDocuments({ org_id: orgA })).toBe(0);
    expect(await col.countDocuments({ org_id: orgB })).toBe(1);
  });

  test("GscAnalyticsCacheRepo.deleteByOrgId removes only that org's cached rows", async () => {
    const col = (await getDb()).collection('gsc_analytics_cache');
    const orgA = `reset_cache_a_${timestamp}`;
    const orgB = `reset_cache_b_${timestamp}`;
    await col.insertMany([
      { org_id: orgA, key: `${orgA}:1`, rows: [] },
      { org_id: orgB, key: `${orgB}:1`, rows: [] },
    ]);

    expect(await GscAnalyticsCacheRepo.deleteByOrgId(orgA)).toBe(1);
    expect(await col.countDocuments({ org_id: orgA })).toBe(0);
    expect(await col.countDocuments({ org_id: orgB })).toBe(1);
  });

  test('deleteByOrgId returns 0 when nothing matches', async () => {
    expect(await KeywordRepo.deleteByOrgId(`reset_no_such_org_${timestamp}`)).toBe(0);
  });

  test('listAllSummaries reports every org, tolerating a legacy-shaped doc', async () => {
    const org = await OrgRepo.create({
      user_id: `list_user_${timestamp}`,
      website_url: `https://list.example.com/${timestamp}`,
      setup_status: 'setup_scan_in_progress',
    });
    // A doc OrgSchema would reject — listAllSummaries must not parse, or a
    // cleanup sweep could never remove exactly the junk it exists to remove.
    const { insertedId } = await (await getDb())
      .collection('orgs')
      .insertOne({ website_url: 42, note: `legacy_${timestamp}` });

    const summaries = await OrgRepo.listAllSummaries();
    const created = summaries.find((s) => s.id === org.id);
    expect(created?.website_url).toBe(`https://list.example.com/${timestamp}`);
    expect(created?.user_id).toBe(`list_user_${timestamp}`);

    const legacy = summaries.find((s) => s.id === insertedId.toString());
    expect(legacy).toEqual({
      id: insertedId.toString(),
      website_url: '',
      user_id: null,
      plan: null,
      setup_status: null,
    });

    await OrgRepo.deleteById(org.id);
    await OrgRepo.deleteById(insertedId.toString());
  });

  test('OrgRepo.deleteById deletes the org and reports the match', async () => {
    const org = await OrgRepo.create({
      user_id: `reset_user_${timestamp}`,
      website_url: `https://reset.example.com/${timestamp}`,
      setup_status: 'setup_scan_in_progress',
    });

    expect(await OrgRepo.deleteById(org.id)).toBe(true);
    expect(await OrgRepo.findById(org.id)).toBeNull();
  });

  test('OrgRepo.deleteById returns false when no org matches', async () => {
    expect(await OrgRepo.deleteById(new ObjectId().toString())).toBe(false);
    expect(await OrgRepo.deleteById('not-an-objectid')).toBe(false);
  });
});
