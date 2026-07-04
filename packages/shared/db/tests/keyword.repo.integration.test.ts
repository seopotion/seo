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
});
