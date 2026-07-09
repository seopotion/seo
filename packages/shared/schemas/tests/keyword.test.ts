import { describe, expect, test } from 'vitest';
import { KeywordSchema } from '../src/keyword';

const base = {
  id: '1',
  org_id: 'o1',
  keyword: 'best crm',
  status: 'scheduled',
  scheduled_date: '2026-07-08',
  search_volume: 100,
  difficulty: 10,
  article_id: null,
  created_at: new Date(),
};

describe('KeywordSchema brief fields', () => {
  test('brief fields default to null (back-compat)', () => {
    const k = KeywordSchema.parse(base);
    expect(k.article_type).toBeNull();
    expect(k.intent).toBeNull();
    expect(k.opportunity_score).toBeNull();
    expect(k.serp_competitors).toBeNull();
  });

  test('brief fields round-trip when present', () => {
    const k = KeywordSchema.parse({
      ...base,
      article_type: 'how_to_guide',
      intent: 'informational',
      opportunity_score: 0.8,
      serp_competitors: ['a.com', 'b.com'],
    });
    expect(k.article_type).toBe('how_to_guide');
    expect(k.serp_competitors).toEqual(['a.com', 'b.com']);
  });
});
