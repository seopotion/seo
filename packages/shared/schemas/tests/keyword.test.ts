import { describe, expect, test } from 'vitest';
import { CreateKeywordInput, KeywordSchema } from '../src/keyword';

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
    const entry = { rank: 1, url: 'https://a.com/x', domain: 'a.com', title: 'A post' };
    const k = KeywordSchema.parse({
      ...base,
      article_type: 'how_to_guide',
      intent: 'informational',
      opportunity_score: 0.8,
      serp_competitors: [entry],
    });
    expect(k.article_type).toBe('how_to_guide');
    expect(k.serp_competitors).toEqual([entry]);
  });

  test('legacy domain-only serp_competitors normalize to entries (#144)', () => {
    const k = KeywordSchema.parse({ ...base, serp_competitors: ['a.com', 'b.com'] });
    expect(k.serp_competitors).toEqual([
      { rank: null, url: null, domain: 'a.com', title: null },
      { rank: null, url: null, domain: 'b.com', title: null },
    ]);
  });
});

describe('KeywordSchema candidate linkage (#99)', () => {
  test('candidate_id defaults to null for legacy documents', () => {
    expect(KeywordSchema.parse(base).candidate_id).toBeNull();
  });

  test('candidate_id round-trips when present and may be omitted on create', () => {
    expect(KeywordSchema.parse({ ...base, candidate_id: 'c1' }).candidate_id).toBe('c1');
    const { id: _id, created_at: _c, ...createBase } = base;
    expect(CreateKeywordInput.parse(createBase).candidate_id).toBeNull();
  });
});
