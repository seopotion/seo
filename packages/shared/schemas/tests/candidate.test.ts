import { describe, expect, test } from 'vitest';
import {
  ARTICLE_TYPES,
  CandidateSchema,
  CreateCandidateInput,
  normalizeKeyword,
  REJECTION_REASONS,
} from '../src';

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

describe('serp_competitors entries (#144)', () => {
  const base = {
    id: 'c1',
    org_id: 'o1',
    keyword: 'best dog food',
    normalized_keyword: 'best dog food',
    source: 'keyword_ideas' as const,
    created_at: new Date(),
    updated_at: new Date(),
  };

  test('round-trips full structured entries', () => {
    const entry = { rank: 1, url: 'https://a.com/x', domain: 'a.com', title: 'A post' };
    const c = CandidateSchema.parse({ ...base, serp_competitors: [entry] });
    expect(c.serp_competitors).toEqual([entry]);
  });

  test('normalizes legacy domain strings into domain-only entries', () => {
    const c = CandidateSchema.parse({ ...base, serp_competitors: ['a.com', 'b.com'] });
    expect(c.serp_competitors).toEqual([
      { rank: null, url: null, domain: 'a.com', title: null },
      { rank: null, url: null, domain: 'b.com', title: null },
    ]);
  });
});

describe('candidate #54 fields', () => {
  const base = {
    id: 'c1',
    org_id: 'o1',
    keyword: 'best dog food',
    normalized_keyword: 'best dog food',
    source: 'keyword_ideas' as const,
    created_at: new Date(),
    updated_at: new Date(),
  };

  test('defaults article_type and rejection_reason to null', () => {
    const c = CandidateSchema.parse(base);
    expect(c.article_type).toBeNull();
    expect(c.rejection_reason).toBeNull();
  });

  test('accepts a valid article_type and rejection_reason', () => {
    const c = CandidateSchema.parse({
      ...base,
      article_type: 'how_to_guide',
      rejection_reason: 'serp_authority',
    });
    expect(c.article_type).toBe('how_to_guide');
    expect(c.rejection_reason).toBe('serp_authority');
  });

  test('rejects an unknown article_type', () => {
    expect(() => CandidateSchema.parse({ ...base, article_type: 'tweet' })).toThrow();
  });

  test('exposes the constrained enums', () => {
    expect(ARTICLE_TYPES).toContain('case_study');
    expect(ARTICLE_TYPES).toContain('other');
    expect(REJECTION_REASONS).toContain('difficulty_ceiling');
  });
});
