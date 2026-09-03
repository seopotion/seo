/**
 * Pure aggregation/statistics helpers behind `db strategy-audit` (#211).
 * Mongo plumbing is deliberately untested — these take plain arrays.
 */
import type { Candidate, Keyword, Org } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import {
  bucketize,
  buildStrategyAudit,
  countBy,
  matchCandidates,
  numericStats,
  percentile,
  relevanceHistogram,
} from '../src/lib/strategy-audit';

describe('percentile', () => {
  test('empty input has no percentile', () => {
    expect(percentile([], 0.5)).toBeNull();
  });

  test('a single element is its own every-percentile', () => {
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([7], 0.25)).toBe(7);
    expect(percentile([7], 1)).toBe(7);
  });

  test('interpolates between neighbours', () => {
    const v = [0, 10, 20, 30, 40];
    expect(percentile(v, 0)).toBe(0);
    expect(percentile(v, 0.5)).toBe(20);
    expect(percentile(v, 1)).toBe(40);
    expect(percentile(v, 0.25)).toBe(10);
    // 3 elements: p25 lands between the 1st and 2nd.
    expect(percentile([0, 10, 20], 0.25)).toBe(5);
  });
});

describe('numericStats', () => {
  test('empty input', () => {
    expect(numericStats([])).toEqual({
      count: 0,
      nulls: 0,
      min: null,
      p25: null,
      median: null,
      p75: null,
      max: null,
    });
  });

  test('all-null input counts the nulls and reports no stats', () => {
    const s = numericStats([null, null, undefined]);
    expect(s.count).toBe(0);
    expect(s.nulls).toBe(3);
    expect(s.median).toBeNull();
  });

  test('single non-null element', () => {
    const s = numericStats([null, 4]);
    expect(s).toEqual({ count: 1, nulls: 1, min: 4, p25: 4, median: 4, p75: 4, max: 4 });
  });

  test('sorts numerically, not lexicographically', () => {
    const s = numericStats([10, 9, 100, 1]);
    expect(s.min).toBe(1);
    expect(s.max).toBe(100);
  });
});

describe('bucketize', () => {
  const buckets = [
    { label: 'low', min: 1, max: 101 },
    { label: 'high', min: 101, max: Number.POSITIVE_INFINITY },
  ];

  test('empty input yields every bucket at zero', () => {
    expect(bucketize([], buckets)).toEqual([
      { label: 'low', count: 0 },
      { label: 'high', count: 0 },
    ]);
  });

  test('ranges are half-open, so a boundary lands in the upper bucket', () => {
    expect(bucketize([100, 101], buckets)).toEqual([
      { label: 'low', count: 1 },
      { label: 'high', count: 1 },
    ]);
  });

  test('values outside every bucket are dropped', () => {
    expect(bucketize([0, -5], buckets)).toEqual([
      { label: 'low', count: 0 },
      { label: 'high', count: 0 },
    ]);
  });
});

describe('relevanceHistogram', () => {
  test('nulls are excluded and 1.0 lands in the last bucket', () => {
    const h = relevanceHistogram([null, 0, 0.05, 0.1, 0.95, 1]);
    expect(h).toHaveLength(10);
    expect(h[0]).toEqual({ label: '0.0–0.1', count: 2 });
    expect(h[1]).toEqual({ label: '0.1–0.2', count: 1 });
    expect(h[9]).toEqual({ label: '0.9–1.0', count: 2 });
  });

  test('empty input still yields ten zeroed buckets', () => {
    const h = relevanceHistogram([]);
    expect(h).toHaveLength(10);
    expect(h.every((b) => b.count === 0)).toBe(true);
  });
});

describe('countBy', () => {
  test('empty input', () => {
    expect(countBy([], String)).toEqual({});
  });

  test('counts by derived key', () => {
    expect(countBy(['a', 'b', 'a'], (s) => s)).toEqual({ a: 2, b: 1 });
  });
});

// ---- report assembly ----

const candidate = (over: Partial<Candidate>): Candidate =>
  ({
    id: 'c1',
    org_id: 'o1',
    keyword: 'Water Bath Canner',
    normalized_keyword: 'water bath canner',
    source: 'keyword_ideas',
    source_context: null,
    search_volume: 22200,
    difficulty: 0,
    cpc: null,
    competition: null,
    trend: null,
    intent: null,
    serp_competitors: null,
    relevance_score: 0,
    opportunity_score: 0.5,
    article_type: null,
    rejection_reason: null,
    status: 'candidate',
    created_at: new Date(),
    updated_at: new Date(),
    ...over,
  }) as Candidate;

const keyword = (over: Partial<Keyword>): Keyword =>
  ({
    id: 'k1',
    org_id: 'o1',
    candidate_id: 'c1',
    keyword: 'Water Bath Canner',
    status: 'scheduled',
    scheduled_date: '2026-08-12',
    search_volume: 22200,
    difficulty: 0,
    article_id: null,
    article_type: null,
    intent: null,
    opportunity_score: 0.5,
    serp_competitors: null,
    created_at: new Date(),
    generation_status: 'pending',
    generation_attempts: 0,
    generation_error: null,
    generation_started_at: null,
    ...over,
  }) as Keyword;

const org = (competitors: string[]): Org =>
  ({
    id: 'o1',
    user_id: 'u1',
    website_url: 'https://clewas.com',
    setup_status: 'setup_complete',
    plan: 'paid',
    strategy_status: 'completed',
    presets: {
      business: { name: 'Clewas', language: 'en', country: 'United States', description: '' },
      audience: { target: ['plant operators'], competitors },
      blog: { sitemap_url: '', main_blog_url: '', best_articles: [] },
      article_preferences: {
        content_seo: {
          article_style: '',
          internal_links_count: 1,
          table_of_contents: true,
          readability_grade_max: 8,
          llm_instructions: '',
        },
        engagement: {
          image_direction: { medium: 'photograph', palette: '', notes: '' },
          include_cta: true,
          youtube_videos: true,
        },
        publishing: { auto_publish: false },
      },
    },
    created_at: new Date(),
  }) as Org;

describe('buildStrategyAudit', () => {
  test('flags an empty competitors list, which disables ranked_keywords', () => {
    const report = buildStrategyAudit({ org: org([]), candidates: [], keywords: [], needles: [] });
    expect(report.org.competitors_empty).toBe(true);
    expect(report.notes.join(' ')).toContain('ranked_keywords');
  });

  test('no note about competitors when some are configured', () => {
    const report = buildStrategyAudit({
      org: org(['aquatech.com']),
      candidates: [],
      keywords: [],
      needles: [],
    });
    expect(report.org.competitors_empty).toBe(false);
    expect(report.notes.join(' ')).not.toContain('ranked_keywords');
  });

  test('an empty org has zeroed diagnostics rather than NaN', () => {
    const report = buildStrategyAudit({ org: org([]), candidates: [], keywords: [], needles: [] });
    expect(report.diagnostics.backfill_fraction).toBe(0);
    expect(report.diagnostics.relevance_exact_zero).toEqual({
      scored: 0,
      exact_zero: 0,
      fraction: 0,
    });
  });

  test("surfaces the latest run's pillar/support split so a pillar-only plan is visible (#294)", () => {
    const run = { stats: { plan: { pillars: 8, supports: 0 } } };
    const report = buildStrategyAudit({
      org: org([]),
      candidates: [],
      keywords: [],
      needles: [],
      run,
    });
    expect(report.diagnostics.plan_targets).toEqual({ pillars: 8, supports: 0 });

    const none = buildStrategyAudit({ org: org([]), candidates: [], keywords: [], needles: [] });
    expect(none.diagnostics.plan_targets).toBeNull();
    const noPlanStats = buildStrategyAudit({
      org: org([]),
      candidates: [],
      keywords: [],
      needles: [],
      run: { stats: {} },
    });
    expect(noPlanStats.diagnostics.plan_targets).toBeNull();
  });

  test('joins the plan to its candidate and derives the diagnostics', () => {
    const candidates = [
      candidate({ id: 'c1' }),
      candidate({
        id: 'c2',
        normalized_keyword: 'membrane fouling control',
        source: 'keywords_for_site',
        relevance_score: 0.9,
        difficulty: 50,
        search_volume: 90,
        serp_competitors: [{ rank: 1, url: null, domain: 'dow.com', title: null }],
      }),
      candidate({ id: 'c3', relevance_score: null, difficulty: null, search_volume: null }),
    ];
    const keywords = [
      keyword({ id: 'k1', candidate_id: 'c1' }),
      keyword({
        id: 'k2',
        candidate_id: 'c2',
        keyword: 'membrane fouling control',
        scheduled_date: '2026-08-11',
        difficulty: 50,
        search_volume: 90,
        serp_competitors: [{ rank: 1, url: null, domain: 'dow.com', title: null }],
      }),
    ];

    const report = buildStrategyAudit({ org: org([]), candidates, keywords, needles: [] });

    // Ordered by scheduled_date, not input order.
    expect(report.plan.map((r) => r.scheduled_date)).toEqual(['2026-08-11', '2026-08-12']);
    expect(report.plan[0]).toMatchObject({
      relevance_score: 0.9,
      source: 'keywords_for_site',
      candidate_join: 'candidate_id',
      serp_validated: true,
    });
    // The unvalidated entry is a backfill pick that never saw SERP validation.
    expect(report.diagnostics.backfill_count).toBe(1);
    expect(report.diagnostics.backfill_fraction).toBe(0.5);
    expect(report.diagnostics.kd_zero_scheduled).toBe(1);
    // Two of three candidates were scored; one of those is exactly 0.
    expect(report.diagnostics.relevance_exact_zero).toEqual({
      scored: 2,
      exact_zero: 1,
      fraction: 0.5,
    });
    expect(report.diagnostics.scheduled_by_source).toEqual({
      keyword_ideas: 1,
      keywords_for_site: 1,
    });
    expect(report.pool.serp_validated).toBe(1);
    expect(report.pool.difficulty).toEqual({
      nulls: 1,
      exact_zero: 1,
      one_to_45: 0,
      above_45: 1,
    });
    expect(report.pool.by_rejection_reason).toEqual({ '(none)': 3 });
  });

  test('unlinked planner entries report a null candidate join', () => {
    const report = buildStrategyAudit({
      org: org([]),
      candidates: [],
      keywords: [keyword({ candidate_id: null })],
      needles: [],
    });
    expect(report.plan[0]).toMatchObject({
      relevance_score: null,
      source: null,
      candidate_join: 'none',
    });
    expect(report.diagnostics.scheduled_by_source).toEqual({ '(none)': 1 });
  });

  test('pre-#99 entries with no candidate_id fall back to a normalized-keyword join', () => {
    const report = buildStrategyAudit({
      org: org([]),
      candidates: [candidate({ id: 'c1', relevance_score: 0.4 })],
      // Same keyword, differently cased, and no linkage — the legacy shape.
      keywords: [keyword({ candidate_id: null, keyword: 'water bath CANNER' })],
      needles: [],
    });
    expect(report.plan[0]).toMatchObject({
      relevance_score: 0.4,
      source: 'keyword_ideas',
      candidate_join: 'normalized_keyword',
    });
    expect(report.notes.join(' ')).toContain('no candidate_id');
  });
});

describe('matchCandidates', () => {
  const pool = [
    candidate({ id: 'c1', normalized_keyword: 'aqual water' }),
    candidate({ id: 'c2', normalized_keyword: 'water bath canner' }),
    candidate({ id: 'c3', normalized_keyword: 'membrane fouling' }),
  ];

  test('no needles matches nothing', () => {
    expect(matchCandidates(pool, [])).toEqual([]);
    expect(matchCandidates(pool, ['  '])).toEqual([]);
  });

  test('case-insensitive substring, deduped across needles', () => {
    expect(matchCandidates(pool, ['WATER', 'canner']).map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
