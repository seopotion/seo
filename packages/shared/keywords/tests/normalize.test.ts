import type { KeywordMetric } from '@shared/providers';
import { describe, expect, it } from 'vitest';
import { dedupe, toWorking } from '../src/normalize';

const metric = (over: Partial<KeywordMetric>): KeywordMetric => ({
  keyword: 'Best Dog  Food',
  core_keyword: null,
  category_ids: [],
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
    const w = toWorking(
      metric({
        keyword: 'Best Dog  Food',
        core_keyword: 'dog food',
        category_ids: [10, 20],
      }),
      'keyword_ideas',
      'seed',
    );
    expect(w.normalized).toBe('best dog food');
    expect(w.source).toBe('keyword_ideas');
    expect(w.source_context).toBe('seed');
    expect(w.core_keyword).toBe('dog food');
    expect(w.category_ids).toEqual([10, 20]);
    expect(w.topic_cluster_id).toBeNull();
    expect(w.topic_cluster_label).toBeNull();
    expect(w.topic_role).toBeNull();
    expect(w.topic_content_focus).toBeNull();
    expect(w.topic_primary_keyword).toBeNull();
    expect(w.status).toBe('candidate');
  });

  it('defaults fields missing from legacy replay metrics', () => {
    const { core_keyword: _core, category_ids: _categories, ...legacy } = metric({});
    const w = toWorking(legacy as KeywordMetric, 'keyword_suggestions', 'seed');
    expect(w.core_keyword).toBeNull();
    expect(w.category_ids).toEqual([]);
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
