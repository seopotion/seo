import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { CandidateRepo } from '../src/repositories/candidate.repo';

/**
 * Real-MongoDB round-trip. Run with `npm run test:integration` after
 * `docker compose up -d mongo`.
 */
describe('CandidateRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('candidates').deleteMany({});
    await ensureIndexes(); // unique (org_id, normalized_keyword) drives dedup
  });

  afterAll(async () => {
    await closeDb();
  });

  test('insertMany derives normalized_keyword and dedupes within batch', async () => {
    const inserted = await CandidateRepo.insertMany('org_cand', [
      { org_id: 'org_cand', keyword: 'Best SEO Tools', source: 'keyword_ideas' },
      { org_id: 'org_cand', keyword: 'best   seo tools', source: 'manual' }, // dup
      { org_id: 'org_cand', keyword: 'notion seo', source: 'manual' },
    ]);
    expect(inserted).toHaveLength(2);
    expect(inserted[0]!.normalized_keyword).toBe('best seo tools');
    expect(inserted[0]!.id).toMatch(/^[a-f0-9]{24}$/);
    expect(inserted[0]!.status).toBe('candidate');
  });

  test('insertMany dedupes against already-stored candidates', async () => {
    const again = await CandidateRepo.insertMany('org_cand', [
      { org_id: 'org_cand', keyword: 'BEST seo tools', source: 'serp' }, // exists
      { org_id: 'org_cand', keyword: 'seo audit', source: 'seed' }, // new
    ]);
    expect(again.map((c) => c.keyword)).toEqual(['seo audit']);
  });

  test('findByNormalized + cross-org isolation', async () => {
    expect(await CandidateRepo.findByNormalized('org_cand', 'notion seo')).not.toBeNull();
    expect(await CandidateRepo.findByNormalized('other_org', 'notion seo')).toBeNull();
  });

  test('listByOrg filters by status', async () => {
    const all = await CandidateRepo.listByOrg('org_cand');
    expect(all.length).toBe(3);
    expect(await CandidateRepo.listByOrg('org_cand', { status: 'selected' })).toHaveLength(0);
  });

  test('setStatus transitions and bumps updated_at', async () => {
    const [first] = await CandidateRepo.listByOrg('org_cand');
    const before = first!.updated_at.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await CandidateRepo.setStatus(first!.id, 'selected');
    const selected = await CandidateRepo.listByOrg('org_cand', { status: 'selected' });
    expect(selected).toHaveLength(1);
    expect(selected[0]!.id).toBe(first!.id);
    expect(selected[0]!.updated_at.getTime()).toBeGreaterThan(before);
  });
});
