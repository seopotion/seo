import { describe, expect, test } from 'vitest';
import { CandidateSchema, CreateCandidateInput, normalizeKeyword } from '../src';

describe('normalizeKeyword', () => {
  test('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeKeyword('  Best   SEO  Tools ')).toBe('best seo tools');
  });
});

describe('CandidateSchema', () => {
  test('parses a full candidate with nullable metrics and scores', () => {
    const c = CandidateSchema.parse({
      id: 'c1',
      org_id: 'o1',
      keyword: 'notion seo',
      normalized_keyword: 'notion seo',
      source: 'keyword_ideas',
      source_context: null,
      search_volume: 170,
      difficulty: 36,
      cpc: 1.2,
      competition: 0.4,
      trend: null,
      intent: 'informational',
      relevance_score: null,
      opportunity_score: null,
      status: 'candidate',
      created_at: new Date(),
      updated_at: new Date(),
    });
    expect(c.opportunity_score).toBeNull();
    expect(c.intent).toBe('informational');
  });
});

describe('CreateCandidateInput', () => {
  test('requires only keyword + source; defaults the rest', () => {
    const parsed = CreateCandidateInput.parse({
      org_id: 'o1',
      keyword: 'seo tools',
      source: 'manual',
    });
    expect(parsed.status).toBe('candidate');
    expect(parsed.search_volume).toBeNull();
    expect(parsed.opportunity_score).toBeNull();
  });

  test('omits server-assigned + derived fields', () => {
    expect('id' in CreateCandidateInput.shape).toBe(false);
    expect('normalized_keyword' in CreateCandidateInput.shape).toBe(false);
    expect('created_at' in CreateCandidateInput.shape).toBe(false);
    expect('updated_at' in CreateCandidateInput.shape).toBe(false);
  });
});
