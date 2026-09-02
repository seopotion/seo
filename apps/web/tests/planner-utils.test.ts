import { describe, expect, test } from 'vitest';
import {
  addMonths,
  buildMonthWeeks,
  combineResearchResults,
  combineTargetKeywords,
  formatNullableNumber,
  getCandidateAddApiError,
  getCandidateScheduleError,
  getKeywordResearchApiError,
  isCandidateScheduleSuccess,
  isSameMonth,
  mapPlannerKeywords,
  startOfMonth,
  toDateKey,
  validateResearchSeed,
} from '../app/[locale]/(authenticated)/(product)/content-planner/planner-utils';
import type {
  CandidateKeywordResponse,
  KeywordMetric,
  PlannerGenerationStatus,
  PlannerKeywordResponse,
} from '../app/[locale]/(authenticated)/(product)/content-planner/types';

function candidate(overrides: Partial<CandidateKeywordResponse> = {}): CandidateKeywordResponse {
  return {
    difficulty: 18,
    id: 'candidate-1',
    intent: 'commercial',
    keyword: 'seo content planning',
    opportunity_score: 81,
    schedulable: true,
    search_volume: 900,
    status: 'candidate',
    ...overrides,
  };
}

function plannerKeyword(overrides: Partial<PlannerKeywordResponse> = {}): PlannerKeywordResponse {
  return {
    article_id: null,
    candidate_id: 'candidate-1',
    difficulty: 23,
    generation_error: null,
    generation_status: 'pending',
    id: 'keyword-1',
    intent: 'informational',
    keyword: 'content planning',
    opportunity_score: 65,
    scheduled_date: '2026-07-20',
    search_volume: 1200,
    ...overrides,
  };
}

function keywordMetric(overrides: Partial<KeywordMetric> = {}): KeywordMetric {
  return {
    competition: 0.4,
    cpc: 1.2,
    difficulty: 30,
    intent: 'commercial',
    keyword: 'content marketing',
    search_volume: 800,
    trend: 2,
    ...overrides,
  };
}

describe('research seed validation', () => {
  test('trims a valid seed', () => {
    expect(validateResearchSeed('  content marketing  ')).toEqual({
      error: null,
      seed: 'content marketing',
    });
  });

  test.each(['', '   ', '\n\t'])('rejects an empty seed', (seed) => {
    expect(validateResearchSeed(seed)).toEqual({ error: 'required', seed: '' });
  });

  test('accepts 200 characters and rejects longer seeds', () => {
    expect(validateResearchSeed('a'.repeat(200)).error).toBeNull();
    expect(validateResearchSeed('a'.repeat(201)).error).toBe('too_long');
  });
});

describe('research result combining', () => {
  test('keeps the seed first and deduplicates normalized keyword text', () => {
    const seed = keywordMetric({ keyword: '  Content   Marketing  ', search_volume: 900 });
    const duplicate = keywordMetric({ keyword: 'content marketing', search_volume: 100 });
    const distinct = keywordMetric({ keyword: 'content strategy' });

    const results = combineResearchResults(seed, [duplicate, distinct]);

    expect(results).toEqual([seed, distinct]);
  });

  test('keeps the first similar result for duplicate normalized keywords', () => {
    const first = keywordMetric({ keyword: 'SEO tools', difficulty: 10 });
    const duplicate = keywordMetric({ keyword: ' seo   TOOLS ', difficulty: 50 });

    expect(combineResearchResults(keywordMetric(), [first, duplicate])).toEqual([
      keywordMetric(),
      first,
    ]);
  });
});

describe('keyword mutation error mapping', () => {
  test.each([
    [400, 'invalid'],
    [401, 'unauthorized'],
    [402, 'upgrade'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [502, 'provider'],
    [500, 'generic'],
  ] as const)('maps research status %s to %s', (status, expected) => {
    expect(getKeywordResearchApiError(status)).toBe(expected);
  });

  test.each([
    [400, 'invalid'],
    [401, 'unauthorized'],
    [402, 'upgrade'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'generic'],
    [502, 'generic'],
  ] as const)('maps candidate-add status %s to %s', (status, expected) => {
    expect(getCandidateAddApiError(status)).toBe(expected);
  });
});

describe('candidate scheduling error mapping', () => {
  test.each([200, 201])('treats status %s as a scheduling success', (status) => {
    expect(isCandidateScheduleSuccess(status)).toBe(true);
  });

  test.each([
    199, 202, 400, 409, 500,
  ])('does not treat status %s as a scheduling success', (status) => {
    expect(isCandidateScheduleSuccess(status)).toBe(false);
  });

  test.each([
    [400, undefined, 'invalid_date'],
    [402, { error: 'not_paid' }, 'upgrade'],
    [404, { error: 'not_found' }, 'not_found'],
    [409, { error: 'date_occupied' }, 'date_occupied'],
    [409, { error: 'keyword_already_scheduled' }, 'keyword_already_scheduled'],
    [409, { error: 'candidate_already_scheduled' }, 'candidate_already_scheduled'],
    [409, { error: 'candidate_not_schedulable' }, 'candidate_not_schedulable'],
  ] as const)('maps status %s with body %o to %s', (status, body, expected) => {
    expect(getCandidateScheduleError(status, body)).toBe(expected);
  });

  test.each([
    [409, undefined],
    [409, { error: 'unknown_conflict' }],
    [409, { error: 123 }],
    [500, { error: 'date_occupied' }],
  ] as const)('maps an unknown status/body combination to generic', (status, body) => {
    expect(getCandidateScheduleError(status, body)).toBe('generic');
  });
});

describe('planner keyword mapping', () => {
  test('preserves nullable candidate ID and opportunity score', () => {
    const [article] = mapPlannerKeywords([
      plannerKeyword({ candidate_id: null, opportunity_score: null }),
    ]);

    expect(article).toMatchObject({
      candidateId: null,
      opportunityScore: null,
    });
  });

  test('preserves an opportunity score of zero', () => {
    const [article] = mapPlannerKeywords([plannerKeyword({ opportunity_score: 0 })]);

    expect(article?.opportunityScore).toBe(0);
  });

  test('carries an unknown difficulty through to the target keyword row (#304)', () => {
    const plannerArticles = mapPlannerKeywords([plannerKeyword({ difficulty: null })]);
    const [target] = combineTargetKeywords([], plannerArticles);

    expect(plannerArticles[0]?.difficulty).toBeNull();
    expect(target).toMatchObject({ difficulty: null, source: 'planner' });
  });

  test('formatNullableNumber renders an unknown metric as the planner dash', () => {
    expect(formatNullableNumber(null, 'en')).toBe('—');
    expect(formatNullableNumber(1200, 'en')).toBe('1,200');
  });

  test.each<{
    articleId: string | null;
    error: string | null;
    status: PlannerGenerationStatus;
  }>([
    { articleId: null, error: null, status: 'pending' },
    { articleId: null, error: null, status: 'generating' },
    { articleId: 'article-1', error: null, status: 'generated' },
    { articleId: null, error: 'generation failed', status: 'failed' },
  ])('preserves $status generation state', ({ articleId, error, status }) => {
    const [article] = mapPlannerKeywords([
      plannerKeyword({
        article_id: articleId,
        generation_error: error,
        generation_status: status,
      }),
    ]);

    expect(article).toMatchObject({
      articleId,
      generationError: error,
      generationStatus: status,
    });
  });

  test('keeps existing calendar display fields and generated status behavior', () => {
    const [article] = mapPlannerKeywords([
      plannerKeyword({
        article_id: 'article-1',
        candidate_id: 'candidate-2',
        generation_status: 'generated',
        intent: 'commercial',
      }),
    ]);

    expect(article).toEqual({
      articleId: 'article-1',
      candidateId: 'candidate-2',
      difficulty: 23,
      generationError: null,
      generationStatus: 'generated',
      id: 'keyword-1',
      intent: 'commercial',
      keyword: 'content planning',
      opportunityScore: 65,
      scheduledDate: '2026-07-20',
      status: 'generated',
      title: 'content planning',
      volume: 1200,
    });
  });
});

describe('target keyword combining', () => {
  test('combines available candidates with scheduled planner rows', () => {
    const plannerArticles = mapPlannerKeywords([
      plannerKeyword({
        candidate_id: 'candidate-2',
        id: 'keyword-2',
        keyword: 'scheduled keyword',
      }),
    ]);

    expect(
      combineTargetKeywords(
        [candidate(), candidate({ id: 'candidate-2', keyword: 'scheduled keyword' })],
        plannerArticles,
      ),
    ).toMatchObject([
      {
        candidateId: 'candidate-1',
        keyword: 'seo content planning',
        source: 'candidate',
        status: 'available',
      },
      {
        candidateId: 'candidate-2',
        keyword: 'scheduled keyword',
        source: 'planner',
        status: 'scheduled',
      },
    ]);
  });

  test('deduplicates candidates against planner rows using candidate ID', () => {
    const plannerArticles = mapPlannerKeywords([plannerKeyword({ candidate_id: 'candidate-1' })]);

    const combined = combineTargetKeywords(
      [candidate(), candidate({ keyword: 'duplicate candidate' })],
      plannerArticles,
    );

    expect(combined).toHaveLength(1);
    expect(combined[0]).toMatchObject({
      candidateId: 'candidate-1',
      source: 'planner',
    });
  });

  test('keeps every legacy planner row with a null candidate ID', () => {
    const plannerArticles = mapPlannerKeywords([
      plannerKeyword({ candidate_id: null, id: 'legacy-1' }),
      plannerKeyword({ candidate_id: null, id: 'legacy-2' }),
    ]);

    const combined = combineTargetKeywords([], plannerArticles);

    expect(combined.map((keyword) => keyword.id)).toEqual(['legacy-1', 'legacy-2']);
  });

  test.each<{
    articleId: string | null;
    generationStatus: PlannerGenerationStatus;
    status: string;
  }>([
    { articleId: null, generationStatus: 'pending', status: 'scheduled' },
    { articleId: null, generationStatus: 'generating', status: 'generating' },
    { articleId: null, generationStatus: 'generated', status: 'generated' },
    { articleId: null, generationStatus: 'failed', status: 'failed' },
    { articleId: 'article-1', generationStatus: 'failed', status: 'generated' },
  ])('maps $generationStatus with article $articleId to $status', ({
    articleId,
    generationStatus,
    status,
  }) => {
    const [targetKeyword] = combineTargetKeywords(
      [],
      mapPlannerKeywords([
        plannerKeyword({
          article_id: articleId,
          generation_status: generationStatus,
        }),
      ]),
    );

    expect(targetKeyword?.status).toBe(status);
  });
});

describe('month navigation helpers', () => {
  test('startOfMonth normalizes to the first day at local midnight', () => {
    const monthStart = startOfMonth(new Date(2026, 8, 17, 13, 45));

    expect(toDateKey(monthStart)).toBe('2026-09-01');
    expect(monthStart.getHours()).toBe(0);
  });

  test('addMonths rolls the year over in both directions', () => {
    expect(toDateKey(addMonths(new Date(2026, 11, 1), 1))).toBe('2027-01-01');
    expect(toDateKey(addMonths(new Date(2026, 0, 1), -1))).toBe('2025-12-01');
  });

  test('addMonths from a 31-day month does not overflow into the next one', () => {
    // Feb has no 31st: naive date math would land on March 3rd.
    expect(toDateKey(addMonths(new Date(2026, 0, 1), 1))).toBe('2026-02-01');
  });

  test('isSameMonth separates the same month number in different years', () => {
    expect(isSameMonth(new Date(2026, 8, 1), new Date(2026, 8, 30))).toBe(true);
    expect(isSameMonth(new Date(2026, 8, 1), new Date(2025, 8, 1))).toBe(false);
  });
});

describe('buildMonthWeeks', () => {
  const today = new Date(2026, 8, 17);

  test('pads to whole Monday-start weeks when the month starts mid-week', () => {
    // 2026-09-01 is a Tuesday, 2026-09-30 a Wednesday.
    const weeks = buildMonthWeeks(new Date(2026, 8, 1), [], today);

    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(toDateKey(weeks[0]![0]!.date)).toBe('2026-08-31');
    expect(toDateKey(weeks.at(-1)!.at(-1)!.date)).toBe('2026-10-04');
  });

  test('adds no leading padding when the month starts on a Monday', () => {
    // 2026-06-01 is a Monday.
    const weeks = buildMonthWeeks(new Date(2026, 5, 1), [], today);

    expect(toDateKey(weeks[0]![0]!.date)).toBe('2026-06-01');
    expect(weeks[0]![0]!.inMonth).toBe(true);
  });

  test('spans six rows for a 31-day month starting on a Sunday', () => {
    // 2026-11-01 is a Sunday: one day in the first row, so November needs six.
    const weeks = buildMonthWeeks(new Date(2026, 10, 1), [], today);

    expect(weeks).toHaveLength(6);
    expect(weeks.flat().filter((day) => day.inMonth)).toHaveLength(30);
  });

  test('flags padding days as outside the month', () => {
    const days = buildMonthWeeks(new Date(2026, 8, 1), [], today).flat();
    const byKey = new Map(days.map((day) => [day.dateKey, day]));

    expect(byKey.get('2026-08-31')?.inMonth).toBe(false);
    expect(byKey.get('2026-09-01')?.inMonth).toBe(true);
    expect(byKey.get('2026-09-30')?.inMonth).toBe(true);
    expect(byKey.get('2026-10-01')?.inMonth).toBe(false);
  });

  test('marks days before today as past, and today itself as not past', () => {
    const byKey = new Map(
      buildMonthWeeks(new Date(2026, 8, 1), [], today)
        .flat()
        .map((day) => [day.dateKey, day]),
    );

    expect(byKey.get('2026-09-16')?.isPast).toBe(true);
    expect(byKey.get('2026-09-17')?.isPast).toBe(false);
    expect(byKey.get('2026-09-18')?.isPast).toBe(false);
  });

  test('attaches an article to its scheduled day', () => {
    const [article] = mapPlannerKeywords([plannerKeyword({ scheduled_date: '2026-09-10' })]);
    const byKey = new Map(
      buildMonthWeeks(new Date(2026, 8, 1), [article!], today)
        .flat()
        .map((day) => [day.dateKey, day]),
    );

    expect(byKey.get('2026-09-10')?.article?.keyword).toBe(article!.keyword);
    expect(byKey.get('2026-09-11')?.article).toBeUndefined();
  });

  test('leaves an article off the padding day it falls on', () => {
    // 2026-08-31 pads September's first row; the article belongs to August's grid.
    const [article] = mapPlannerKeywords([plannerKeyword({ scheduled_date: '2026-08-31' })]);
    const september = buildMonthWeeks(new Date(2026, 8, 1), [article!], today).flat();
    const august = buildMonthWeeks(new Date(2026, 7, 1), [article!], today).flat();

    expect(september.find((day) => day.dateKey === '2026-08-31')?.article).toBeUndefined();
    expect(august.find((day) => day.dateKey === '2026-08-31')?.article?.keyword).toBe(
      article!.keyword,
    );
  });

  test('shows articles scheduled in a past month', () => {
    const [article] = mapPlannerKeywords([plannerKeyword({ scheduled_date: '2026-07-20' })]);
    const july = buildMonthWeeks(new Date(2026, 6, 1), [article!], today).flat();
    const day = july.find((entry) => entry.dateKey === '2026-07-20');

    expect(day?.article?.keyword).toBe(article!.keyword);
    expect(day?.isPast).toBe(true);
  });
});
