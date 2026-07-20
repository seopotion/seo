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

  test('listByOrg filters by status and reports total', async () => {
    const all = await CandidateRepo.listByOrg('org_cand');
    expect(all.candidates.length).toBe(3);
    expect(all.total).toBe(3);
    const selected = await CandidateRepo.listByOrg('org_cand', { status: 'selected' });
    expect(selected.candidates).toHaveLength(0);
    expect(selected.total).toBe(0);
  });

  test('listByOrg paginates with stable ordering and total for the full filter', async () => {
    const page1 = await CandidateRepo.listByOrg('org_cand', { limit: 2, offset: 0 });
    const page2 = await CandidateRepo.listByOrg('org_cand', { limit: 2, offset: 2 });
    expect(page1.candidates).toHaveLength(2);
    expect(page2.candidates).toHaveLength(1);
    expect(page1.total).toBe(3);
    expect(page2.total).toBe(3);
    const ids = [...page1.candidates, ...page2.candidates].map((c) => c.id);
    expect(new Set(ids).size).toBe(3); // no overlap across pages
  });

  test('findById returns the candidate; null for unknown/invalid ids', async () => {
    const { candidates } = await CandidateRepo.listByOrg('org_cand');
    const found = await CandidateRepo.findById(candidates[0]!.id);
    expect(found?.id).toBe(candidates[0]!.id);
    expect(await CandidateRepo.findById('not-an-object-id')).toBeNull();
    expect(await CandidateRepo.findById('ffffffffffffffffffffffff')).toBeNull();
  });

  test('claimForScheduling has exactly one winner; release restores the pool', async () => {
    const { candidates } = await CandidateRepo.listByOrg('org_cand', { status: 'candidate' });
    const target = candidates[0]!;

    const [a, b] = await Promise.all([
      CandidateRepo.claimForScheduling(target.id),
      CandidateRepo.claimForScheduling(target.id),
    ]);
    expect([a, b].filter((r) => r !== null)).toHaveLength(1);
    expect((a ?? b)!.status).toBe('selected');

    expect(await CandidateRepo.releaseAfterUnschedule(target.id)).toBe(true);
    // Releasing a non-selected candidate is a no-op.
    expect(await CandidateRepo.releaseAfterUnschedule(target.id)).toBe(false);
    const reloaded = await CandidateRepo.findById(target.id);
    expect(reloaded!.status).toBe('candidate');
  });

  test('setStatus transitions and bumps updated_at', async () => {
    const {
      candidates: [first],
    } = await CandidateRepo.listByOrg('org_cand');
    const before = first!.updated_at.getTime();
    await new Promise((r) => setTimeout(r, 5));
    await CandidateRepo.setStatus(first!.id, 'selected');
    const { candidates: selected } = await CandidateRepo.listByOrg('org_cand', {
      status: 'selected',
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]!.id).toBe(first!.id);
    expect(selected[0]!.updated_at.getTime()).toBeGreaterThan(before);
  });
});
