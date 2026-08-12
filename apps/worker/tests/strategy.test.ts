import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  findById,
  setStrategyStatus,
  persistStrategyCandidates,
  scheduleCandidate,
  listByOrg,
  findByNormalized,
} = vi.hoisted(() => ({
  findById: vi.fn(),
  setStrategyStatus: vi.fn(async () => {}),
  persistStrategyCandidates: vi.fn(async (_orgId: string, items: { keyword: string }[]) =>
    items.map((c, i) => ({
      ...c,
      id: `cand_${i}`,
      normalized_keyword: c.keyword.trim().toLowerCase().replace(/\s+/g, ' '),
    })),
  ),
  scheduleCandidate: vi.fn(
    async (cand: { id: string; keyword: string }, scheduled_date: string) => ({
      ok: true,
      created: true,
      keyword: { id: `kw_${cand.id}`, candidate_id: cand.id, scheduled_date },
    }),
  ),
  listByOrg: vi.fn(async () => []),
  findByNormalized: vi.fn(async () => null),
}));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById, setStrategyStatus },
  KeywordRepo: { listByOrg },
  CandidateRepo: { findByNormalized },
  persistStrategyCandidates,
  scheduleCandidate,
}));

const { runKeywordPipeline } = vi.hoisted(() => ({ runKeywordPipeline: vi.fn() }));
vi.mock('@shared/keywords', async (orig) => ({
  ...(await orig<typeof import('@shared/keywords')>()),
  runKeywordPipeline,
}));

vi.mock('../src/providers', () => ({
  getStrategyClients: () => ({ dataForSeo: {}, llm: {} }),
}));

import { handler } from '../src/strategy';

function event(body: unknown): SQSEvent {
  return {
    Records: [
      {
        messageId: '1',
        receiptHandle: 'rh',
        body: JSON.stringify(body),
        attributes: {} as never,
        messageAttributes: {},
        md5OfBody: '',
        eventSource: 'aws:sqs',
        eventSourceARN: 'arn',
        awsRegion: 'us-east-1',
      },
    ],
  };
}

const org = {
  id: 'o1',
  user_id: 'u1',
  website_url: 'https://example.com',
  setup_status: 'setup_complete',
  plan: 'paid',
  strategy_status: 'pending',
  presets: {
    business: { name: 'X', language: 'English', country: 'Global (English)' },
    audience: { target: ['devs'], competitors: [] },
  },
  created_at: new Date(),
};

function candidate(
  kw: string,
  score: number,
  topic: Partial<{
    topic_cluster_id: string;
    topic_cluster_label: string;
    topic_role: 'pillar' | 'support';
    topic_content_focus: string;
    topic_primary_keyword: string;
    article_type: 'how_to_guide' | 'listicle' | 'comparison';
  }> = {},
) {
  const normalized = kw.trim().toLowerCase().replace(/\s+/g, ' ');
  return {
    org_id: 'o1',
    keyword: kw,
    source: 'seed',
    source_context: null,
    core_keyword: null,
    category_ids: [],
    topic_cluster_id: `topic:${normalized}`,
    topic_cluster_label: `${kw} cluster`,
    topic_role: 'pillar',
    topic_content_focus: `${kw} focus`,
    topic_primary_keyword: kw,
    search_volume: 100,
    difficulty: 10,
    cpc: null,
    competition: null,
    trend: null,
    intent: 'informational',
    relevance_score: 1,
    opportunity_score: score,
    article_type: 'how_to_guide',
    rejection_reason: null,
    status: 'candidate',
    serp_competitors: [{ rank: 1, url: 'https://a.com/1', domain: 'a.com', title: 'A' }],
    serp_validated: true,
    ...topic,
  };
}

function storedCandidate<T extends ReturnType<typeof candidate>>(
  value: T,
  id: string,
  over: Record<string, unknown> = {},
) {
  return {
    ...value,
    id,
    normalized_keyword: value.keyword.trim().toLowerCase().replace(/\s+/g, ' '),
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-08-12T00:00:00.000Z'),
    ...over,
  };
}

describe('strategy worker', () => {
  beforeEach(() => vi.clearAllMocks());

  test('runs pipeline, schedules top candidates, completes', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]); // no existing scheduled keywords
    runKeywordPipeline.mockResolvedValue({
      candidates: [
        candidate('a', 0.9),
        candidate('b', 0.8),
        {
          ...candidate('rejected', 0.5),
          status: 'rejected',
          rejection_reason: 'topic_duplicate',
          topic_primary_keyword: 'a',
        },
      ],
      stats: {},
    });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(persistStrategyCandidates).toHaveBeenCalledTimes(1);
    expect(persistStrategyCandidates).toHaveBeenCalledWith(
      'o1',
      expect.arrayContaining([
        expect.objectContaining({
          keyword: 'a',
          topic_cluster_id: 'topic:a',
          topic_role: 'pillar',
          topic_primary_keyword: 'a',
        }),
        expect.objectContaining({
          keyword: 'rejected',
          rejection_reason: 'topic_duplicate',
        }),
      ]),
    );
    expect(scheduleCandidate).toHaveBeenCalledTimes(2); // rejected one excluded
    // Stored candidates (with ids) are what get scheduled — candidate_id linkage.
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({ id: expect.any(String) });
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'completed');
  });

  test('schedules cluster pillars first, then drains supports round-robin without article-type spreading', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const candidates = [
      candidate('A support high', 100, {
        topic_cluster_id: 'topic:a',
        topic_cluster_label: 'A',
        topic_role: 'support',
        article_type: 'how_to_guide',
      }),
      candidate('B support', 80, {
        topic_cluster_id: 'topic:b',
        topic_cluster_label: 'B',
        topic_role: 'support',
        article_type: 'listicle',
      }),
      candidate('A pillar', 10, {
        topic_cluster_id: 'topic:a',
        topic_cluster_label: 'A',
        article_type: 'comparison',
      }),
      candidate('B pillar', 90, {
        topic_cluster_id: 'topic:b',
        topic_cluster_label: 'B',
        article_type: 'comparison',
      }),
      candidate('A support low', 70, {
        topic_cluster_id: 'topic:a',
        topic_cluster_label: 'A',
        topic_role: 'support',
        article_type: 'comparison',
      }),
    ];
    runKeywordPipeline.mockResolvedValue({ candidates, stats: {} });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate.mock.calls.map(([row]) => row.keyword)).toEqual([
      'A pillar',
      'B pillar',
      'A support high',
      'B support',
      'A support low',
    ]);
  });

  test('a failed pillar blocks its support while later safe targets fill the remaining budget', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue(
      Array.from({ length: 28 }, (_, index) => ({
        keyword: `existing-${index}`,
        opportunity_score: 50,
        scheduled_date: `2026-07-${String(index + 1).padStart(2, '0')}`,
        topic_cluster_id: null,
        topic_role: null,
      })) as never,
    );
    const failedPillar = candidate('Failed pillar', 100, {
      topic_cluster_id: 'topic:failed',
      topic_cluster_label: 'Failed',
    });
    const blockedSupport = candidate('Blocked support', 90, {
      topic_cluster_id: 'topic:failed',
      topic_cluster_label: 'Failed',
      topic_role: 'support',
    });
    const laterPillar = candidate('Later pillar', 80, {
      topic_cluster_id: 'topic:later',
      topic_cluster_label: 'Later',
    });
    const laterSupport = candidate('Later support', 70, {
      topic_cluster_id: 'topic:later',
      topic_cluster_label: 'Later',
      topic_role: 'support',
    });
    runKeywordPipeline.mockResolvedValue({
      candidates: [failedPillar, blockedSupport, laterPillar, laterSupport],
      stats: {},
    });
    scheduleCandidate.mockResolvedValueOnce({
      ok: false,
      reason: 'candidate_not_schedulable',
    } as never);

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate.mock.calls.map(([row]) => row.keyword)).toEqual([
      'Failed pillar',
      'Later pillar',
      'Later support',
    ]);
    expect(scheduleCandidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'Blocked support' }),
      expect.any(String),
    );
  });

  test('a pillar losing both date-race attempts does not establish its cluster', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const pillar = candidate('Race-losing pillar', 100, {
      topic_cluster_id: 'topic:race',
      topic_cluster_label: 'Race',
    });
    const support = candidate('Blocked race support', 90, {
      topic_cluster_id: 'topic:race',
      topic_cluster_label: 'Race',
      topic_role: 'support',
    });
    runKeywordPipeline.mockResolvedValue({ candidates: [pillar, support], stats: {} });
    scheduleCandidate
      .mockResolvedValueOnce({ ok: false, reason: 'date_occupied' } as never)
      .mockResolvedValueOnce({ ok: false, reason: 'date_occupied' } as never);

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(2);
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({ keyword: 'Race-losing pillar' });
    expect(scheduleCandidate.mock.calls[1]![0]).toMatchObject({ keyword: 'Race-losing pillar' });
    expect(scheduleCandidate.mock.calls[1]![1]).not.toBe(scheduleCandidate.mock.calls[0]![1]);
    expect(scheduleCandidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'Blocked race support' }),
      expect.any(String),
    );
  });

  test('a newly scheduled pillar confirms its cluster for a later support', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const pillar = candidate('New pillar', 100, {
      topic_cluster_id: 'topic:new',
      topic_cluster_label: 'New',
    });
    const support = candidate('New support', 90, {
      topic_cluster_id: 'topic:new',
      topic_cluster_label: 'New',
      topic_role: 'support',
    });
    runKeywordPipeline.mockResolvedValue({ candidates: [pillar, support], stats: {} });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate.mock.calls.map(([row]) => row.keyword)).toEqual([
      'New pillar',
      'New support',
    ]);
  });

  test('an idempotent pillar schedule confirms its cluster and consumes one slot', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const pillar = candidate('Idempotent pillar', 100, {
      topic_cluster_id: 'topic:idempotent',
      topic_cluster_label: 'Idempotent',
    });
    const support = candidate('Idempotent support', 90, {
      topic_cluster_id: 'topic:idempotent',
      topic_cluster_label: 'Idempotent',
      topic_role: 'support',
    });
    runKeywordPipeline.mockResolvedValue({ candidates: [pillar, support], stats: {} });
    scheduleCandidate.mockImplementationOnce(async (stored, scheduledDate) => ({
      ok: true,
      created: false,
      keyword: {
        id: 'existing-keyword',
        candidate_id: stored.id,
        scheduled_date: scheduledDate,
      },
    }));

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate.mock.calls.map(([row]) => row.keyword)).toEqual([
      'Idempotent pillar',
      'Idempotent support',
    ]);
    expect(scheduleCandidate.mock.calls[1]![1]).not.toBe(scheduleCandidate.mock.calls[0]![1]);
  });

  test('selects from the complete pool before applying the remaining budget', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue(
      Array.from({ length: 29 }, (_, index) => ({
        keyword: `existing-${index}`,
        opportunity_score: 50,
        scheduled_date: `2026-06-${String(index + 1).padStart(2, '0')}`,
        topic_cluster_id: null,
        topic_role: null,
      })) as never,
    );
    runKeywordPipeline.mockResolvedValue({
      candidates: [
        candidate('High cluster support', 100, {
          topic_cluster_id: 'topic:high-cluster',
          topic_cluster_label: 'High cluster',
          topic_role: 'support',
        }),
        candidate('High cluster pillar', 1, {
          topic_cluster_id: 'topic:high-cluster',
          topic_cluster_label: 'High cluster',
        }),
        candidate('Individual high pillar', 90),
      ],
      stats: {},
    });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(1);
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({
      keyword: 'High cluster pillar',
      opportunity_score: 1,
      topic_role: 'pillar',
    });
  });

  test('schedules the refreshed persisted copy of a pre-existing candidate', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const pipelineCandidate = candidate('Refresh Me', 0.9, {
      topic_cluster_label: 'Current cluster label',
      topic_content_focus: 'Current content focus',
    });
    const refreshed = {
      ...pipelineCandidate,
      id: 'existing-candidate-id',
      keyword: 'REFRESH ME',
      normalized_keyword: 'refresh me',
      source: 'manual',
      source_context: 'prior research',
      topic_cluster_label: 'Current cluster label',
      topic_content_focus: 'Current content focus',
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-08-12T00:00:00.000Z'),
    };
    runKeywordPipeline.mockResolvedValue({ candidates: [pipelineCandidate], stats: {} });
    persistStrategyCandidates.mockResolvedValueOnce([refreshed]);

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(1);
    expect(scheduleCandidate.mock.calls[0]![0]).toBe(refreshed);
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({
      id: 'existing-candidate-id',
      status: 'candidate',
      topic_cluster_label: 'Current cluster label',
      topic_content_focus: 'Current content focus',
    });
    expect(findByNormalized).not.toHaveBeenCalled();
  });

  test('never schedules a pre-existing variant refreshed as topic_duplicate', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const primary = candidate('primary', 0.9);
    const duplicate = {
      ...candidate('primary variant', 0.8),
      status: 'rejected',
      rejection_reason: 'topic_duplicate',
      topic_primary_keyword: 'primary',
    };
    runKeywordPipeline.mockResolvedValue({ candidates: [primary, duplicate], stats: {} });
    persistStrategyCandidates.mockResolvedValueOnce([
      {
        ...primary,
        id: 'primary-id',
        normalized_keyword: 'primary',
      },
      {
        ...duplicate,
        id: 'existing-variant-id',
        normalized_keyword: 'primary variant',
      },
    ]);

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(1);
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({ id: 'primary-id' });
    expect(scheduleCandidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: 'existing-variant-id' }),
      expect.any(String),
    );
  });

  test('a current semantic pillar already scheduled in a legacy row establishes its cluster', async () => {
    findById.mockResolvedValue(org);
    const pillar = candidate('Existing pillar', 20, {
      topic_cluster_id: 'topic:shared',
      topic_cluster_label: 'Shared',
    });
    const support = candidate('New support', 90, {
      topic_cluster_id: 'topic:shared',
      topic_cluster_label: 'Shared',
      topic_role: 'support',
    });
    listByOrg.mockResolvedValue([
      {
        keyword: pillar.keyword,
        opportunity_score: pillar.opportunity_score,
        scheduled_date: '2026-08-01',
        topic_cluster_id: null,
        topic_role: null,
      },
    ] as never);
    runKeywordPipeline.mockResolvedValue({ candidates: [support, pillar], stats: {} });
    persistStrategyCandidates.mockResolvedValueOnce([
      storedCandidate(support, 'new-support-id'),
    ] as never);

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(1);
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({
      id: 'new-support-id',
      keyword: 'New support',
      topic_role: 'support',
    });
    expect(scheduleCandidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'Existing pillar' }),
      expect.any(String),
    );
  });

  test('a scheduled support alone does not establish a cluster with an unavailable pillar', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([
      {
        keyword: 'Old support',
        opportunity_score: 50,
        scheduled_date: '2026-08-01',
        topic_cluster_id: 'topic:shared',
        topic_role: 'support',
      },
    ] as never);
    const pillar = candidate('Unavailable pillar', 100, {
      topic_cluster_id: 'topic:shared',
      topic_cluster_label: 'Shared',
    });
    const support = candidate('Blocked support', 90, {
      topic_cluster_id: 'topic:shared',
      topic_cluster_label: 'Shared',
      topic_role: 'support',
    });
    runKeywordPipeline.mockResolvedValue({ candidates: [pillar, support], stats: {} });
    persistStrategyCandidates.mockResolvedValueOnce([
      storedCandidate(pillar, 'rejected-pillar', {
        status: 'rejected',
        rejection_reason: 'serp_intent',
      }),
      storedCandidate(support, 'blocked-support'),
    ] as never);

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).not.toHaveBeenCalled();
  });

  test('a persisted rejected high-score row does not consume the remaining slot', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue(
      Array.from({ length: 29 }, (_, index) => ({
        keyword: `legacy-${index}`,
        opportunity_score: 50,
        scheduled_date: `2026-07-${String(index + 1).padStart(2, '0')}`,
        topic_cluster_id: null,
        topic_role: null,
      })) as never,
    );
    const rejectedHigh = candidate('Rejected high', 100);
    const laterEligible = candidate('Later eligible', 10);
    runKeywordPipeline.mockResolvedValue({
      candidates: [rejectedHigh, laterEligible],
      stats: {},
    });
    persistStrategyCandidates.mockResolvedValueOnce([
      storedCandidate(rejectedHigh, 'rejected-high-id', {
        status: 'rejected',
        rejection_reason: 'serp_intent',
      }),
      storedCandidate(laterEligible, 'later-id'),
    ] as never);

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(1);
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({
      id: 'later-id',
      keyword: 'Later eligible',
    });
  });

  test('fails loudly when an accepted primary has missing topic metadata', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    runKeywordPipeline.mockResolvedValue({
      candidates: [{ ...candidate('Broken target', 90), topic_cluster_id: null }],
      stats: {},
    });

    await expect(handler(event({ org_id: 'o1' }), {} as never, () => {})).rejects.toThrow(
      /topic_cluster_id must be a non-empty string/i,
    );

    expect(persistStrategyCandidates).not.toHaveBeenCalled();
    expect(scheduleCandidate).not.toHaveBeenCalled();
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'failed');
  });

  test('never schedules a candidate that was not SERP-validated', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    // The below-serpTopN tier: no rejection reason, real metrics, but never
    // validated. It used to backfill the plan; now it must be invisible (#211).
    runKeywordPipeline.mockResolvedValue({
      candidates: [
        candidate('validated', 0.5),
        { ...candidate('below-n', 0.9), serp_validated: false, article_type: null },
      ],
      stats: {},
    });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(1);
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({ keyword: 'validated' });
  });

  test('under-fills the plan rather than padding it, and still completes', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    runKeywordPipeline.mockResolvedValue({
      candidates: Array.from({ length: 3 }, (_, i) => candidate(`k${i}`, 0.9 - i * 0.1)),
      stats: {},
    });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(3); // 3, not PLAN_DAYS
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'completed');
  });

  test('skips when already completed (idempotent)', async () => {
    findById.mockResolvedValue({ ...org, strategy_status: 'completed' });
    await handler(event({ org_id: 'o1' }), {} as never, () => {});
    expect(runKeywordPipeline).not.toHaveBeenCalled();
    expect(scheduleCandidate).not.toHaveBeenCalled();
  });

  test('skips dates occupied by existing (e.g. manual) planner entries', async () => {
    findById.mockResolvedValue(org);
    const today = new Date().toISOString().slice(0, 10);
    listByOrg.mockResolvedValue([
      { keyword: 'manual entry', opportunity_score: null, scheduled_date: today },
    ] as never);
    runKeywordPipeline.mockResolvedValue({ candidates: [candidate('a', 0.9)], stats: {} });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(1);
    const requestedDate = scheduleCandidate.mock.calls[0]![1];
    expect(requestedDate).not.toBe(today); // shifted off the occupied day
  });

  test('a per-entry conflict does not fail the job; a date race retries once', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    runKeywordPipeline.mockResolvedValue({
      candidates: [candidate('a', 0.9), candidate('b', 0.8)],
      stats: {},
    });
    // First entry loses a date race, then succeeds on the next free day;
    // second entry hits a non-retryable conflict and is skipped.
    scheduleCandidate
      .mockResolvedValueOnce({ ok: false, reason: 'date_occupied' } as never)
      .mockResolvedValueOnce({
        ok: true,
        created: true,
        keyword: { id: 'kw_a', candidate_id: 'cand_0', scheduled_date: '2027-01-02' },
      } as never)
      .mockResolvedValueOnce({ ok: false, reason: 'keyword_already_scheduled' } as never);

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate).toHaveBeenCalledTimes(3);
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'completed'); // job still completes
  });

  test('budgets remaining schedule against already-scheduled strategy keywords (redelivery)', async () => {
    findById.mockResolvedValue(org);
    const preExisting = Array.from({ length: 28 }, (_, i) => ({
      keyword: `existing-${i}`,
      opportunity_score: 0.5,
    }));
    listByOrg.mockResolvedValue(preExisting as never);
    runKeywordPipeline.mockResolvedValue({
      candidates: Array.from({ length: 10 }, (_, i) => candidate(`fresh-${i}`, 0.9 - i * 0.01)),
      stats: {},
    });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(scheduleCandidate.mock.calls.length).toBeLessThanOrEqual(2); // PLAN_DAYS(30) - 28
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'completed');
  });

  test('marks failed and rethrows on pipeline error', async () => {
    findById.mockResolvedValue(org);
    runKeywordPipeline.mockRejectedValue(new Error('provider down'));
    await expect(handler(event({ org_id: 'o1' }), {} as never, () => {})).rejects.toThrow(
      'provider down',
    );
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'failed');
  });

  test('aborts before the Lambda deadline, marking the org failed', async () => {
    vi.useFakeTimers();
    try {
      findById.mockResolvedValue(org);
      runKeywordPipeline.mockReturnValue(new Promise(() => {})); // never resolves (hangs)
      // 25s remaining - 20s buffer = 5s budget before the graceful abort fires.
      const ctx = { getRemainingTimeInMillis: () => 25_000 } as never;
      const p = handler(event({ org_id: 'o1' }), ctx, () => {});
      const assertion = expect(p).rejects.toThrow(/approaching Lambda timeout/);
      await vi.advanceTimersByTimeAsync(6_000);
      await assertion;
      expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'failed');
    } finally {
      vi.useRealTimers();
    }
  });
});
