import type { KeywordMetric } from '@shared/providers';
import { describe, expect, it } from 'vitest';
import { dedupe, toWorking } from '../src/normalize';

const metric = (over: Partial<KeywordMetric>): KeywordMetric => ({
  keyword: 'Best Dog  Food',
  search_volume: null,
  difficulty: null,
  cpc: null,
  competition: null,
  trend: null,
  intent: null,
  ...over,
});

describe('toWorking', () => {
  it('normalizes the keyword and carries provenance', () => {
    const w = toWorking(metric({ keyword: 'Best Dog  Food' }), 'keyword_ideas', 'seed');
    expect(w.normalized).toBe('best dog food');
    expect(w.source).toBe('keyword_ideas');
    expect(w.source_context).toBe('seed');
    expect(w.status).toBe('candidate');
  });
});

describe('dedupe', () => {
  it('collapses same normalized keyword, keeping the richer record', () => {
    const bare = toWorking(metric({ keyword: 'dog food' }), 'keyword_ideas', null);
    const rich = toWorking(
      metric({ keyword: 'Dog Food', search_volume: 100, difficulty: 10 }),
      'ranked_keywords',
      'comp.com',
    );
    const out = dedupe([bare, rich]);
    expect(out).toHaveLength(1);
    expect(out[0]!.search_volume).toBe(100);
    expect(out[0]!.source).toBe('ranked_keywords');
  });

  it('keeps distinct keywords', () => {
    const a = toWorking(metric({ keyword: 'a' }), 'keyword_ideas', null);
    const b = toWorking(metric({ keyword: 'b' }), 'keyword_ideas', null);
    expect(dedupe([a, b])).toHaveLength(2);
  });
});
