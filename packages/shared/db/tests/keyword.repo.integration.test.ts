import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { closeDb, getDb } from '../src/client';
import { KeywordRepo } from '../src/repositories/keyword.repo';

/**
 * Real-MongoDB round-trip. Run with `npm run test:integration` after
 * `docker compose up -d mongo`.
 */
describe('KeywordRepo (integration)', () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({});
  });

  afterAll(async () => {
    await closeDb();
  });

  test('create + listByOrg orders by scheduled_date asc', async () => {
    await KeywordRepo.create({
      org_id: 'org_kw',
      keyword: 'later',
      status: 'scheduled',
      scheduled_date: '2026-07-05',
      search_volume: 100,
      difficulty: 10,
      article_id: null,
    });
    await KeywordRepo.create({
      org_id: 'org_kw',
      keyword: 'earlier',
      status: 'scheduled',
      scheduled_date: '2026-07-02',
      search_volume: 200,
      difficulty: 20,
      article_id: null,
    });

    const list = await KeywordRepo.listByOrg('org_kw');
    expect(list.map((k) => k.keyword)).toEqual(['earlier', 'later']);
    expect(list[0]!.id).toMatch(/^[a-f0-9]{24}$/);
    expect(list[0]!.created_at).toBeInstanceOf(Date);
  });

  test('countScheduled counts only this org', async () => {
    expect(await KeywordRepo.countScheduled('org_kw')).toBe(2);
    expect(await KeywordRepo.countScheduled('other_org')).toBe(0);
  });

  test('setArticleId links an article to the keyword', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_link',
      keyword: 'link me',
      status: 'scheduled',
      scheduled_date: '2026-07-03',
      search_volume: 50,
      difficulty: 5,
      article_id: null,
    });
    await KeywordRepo.setArticleId(k.id, 'art_123');
    const [reloaded] = await KeywordRepo.listByOrg('org_link');
    expect(reloaded!.article_id).toBe('art_123');
  });

  test('claimGeneration is atomic and single-winner; linkArticle links', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_gen',
      keyword: 'claim me',
      status: 'scheduled',
      scheduled_date: '2026-07-01',
      search_volume: 10,
      difficulty: 1,
      article_id: null,
    });

    const [a, b] = await Promise.all([
      KeywordRepo.claimGeneration(k.id),
      KeywordRepo.claimGeneration(k.id),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one wins

    const claimed = await KeywordRepo.findById(k.id);
    expect(claimed!.generation_status).toBe('generating');
    expect(claimed!.generation_attempts).toBe(1);

    await KeywordRepo.linkArticle(k.id, 'art_gen');
    const linked = await KeywordRepo.findById(k.id);
    expect(linked!.article_id).toBe('art_gen');
    expect(linked!.generation_status).toBe('generated');
  });

  test('failGeneration records the error and status', async () => {
    const k = await KeywordRepo.create({
      org_id: 'org_gen',
      keyword: 'fail me',
      status: 'scheduled',
      // Distinct from 'claim me': unique (org_id, scheduled_date) index (#99).
      scheduled_date: '2026-07-02',
      search_volume: 10,
      difficulty: 1,
      article_id: null,
    });
    await KeywordRepo.claimGeneration(k.id);
    await KeywordRepo.failGeneration(k.id, 'boom');
    const reloaded = await KeywordRepo.findById(k.id);
    expect(reloaded!.generation_status).toBe('failed');
    expect(reloaded!.generation_error).toBe('boom');
  });

  test('listDueForGeneration excludes future, linked, generated, and capped entries', async () => {
    const db = await getDb();
    await db.collection('keywords').deleteMany({ org_id: 'org_due' });
    const mk = (over: Record<string, unknown>) =>
      KeywordRepo.create({
        org_id: 'org_due',
        keyword: `k-${Math.random()}`,
        status: 'scheduled',
        scheduled_date: '2026-07-01',
        search_volume: 10,
        difficulty: 1,
        article_id: null,
        ...over,
      });
    // Distinct dates: keywords carry a unique (org_id, scheduled_date) index (#99).
    const due = await mk({ scheduled_date: '2026-07-01' });
    await mk({ scheduled_date: '2999-01-01' }); // future
    const linked = await mk({ scheduled_date: '2026-07-02' });
    await KeywordRepo.linkArticle(linked.id, 'x'); // linked + generated
    const capped = await mk({ scheduled_date: '2026-07-03' });
    await db.collection('keywords').updateOne(
      { _id: (await import('mongodb')).ObjectId.createFromHexString(capped.id) },
      {
        $set: { generation_attempts: 3, generation_status: 'failed' },
      },
    );

    const result = await KeywordRepo.listDueForGeneration('2026-07-08', 3);
    const ids = result.map((k) => k.id);
    expect(ids).toContain(due.id);
    expect(ids).not.toContain(linked.id);
    expect(ids).not.toContain(capped.id);
    expect(result.every((k) => k.scheduled_date <= '2026-07-08')).toBe(true);
  });
});
