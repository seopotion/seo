import { normalizeKeyword } from '@shared/schemas';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { getDb } from '../src/client';
import { addCandidates } from '../src/services/add-candidates';

describe('addCandidates', () => {
  beforeEach(async () => {
    const db = await getDb();
    await db.collection('candidates').deleteMany({});
    await db.collection('keywords').deleteMany({});
  });
  afterAll(async () => {
    const db = await getDb();
    await db.collection('candidates').deleteMany({});
    await db.collection('keywords').deleteMany({});
  });

  test('skips keywords already scheduled in the planner', async () => {
    await (await getDb()).collection('keywords').insertOne({
      org_id: 'o1',
      keyword: 'Best CRM',
      normalized_keyword: normalizeKeyword('Best CRM'),
      status: 'scheduled',
      scheduled_date: '2026-07-08',
      search_volume: 100,
      difficulty: 10,
      article_id: null,
      created_at: new Date(),
    });

    const added = await addCandidates('o1', [
      { org_id: 'o1', keyword: 'best crm', source: 'manual' },
      { org_id: 'o1', keyword: 'crm pricing', source: 'manual' },
    ]);

    expect(added.map((c) => c.keyword)).toEqual(['crm pricing']);
  });
});
