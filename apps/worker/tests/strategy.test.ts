import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const {
  findById,
  setStrategyStatus,
  addCandidates,
  scheduleCandidate,
  listByOrg,
  findByNormalized,
} = vi.hoisted(() => ({
  findById: vi.fn(),
  setStrategyStatus: vi.fn(async () => {}),
  // addCandidates echoes inserted candidates back with ids + normalized keys,
  // like the real service, so the worker can schedule them by id.
  addCandidates: vi.fn(async (_orgId: string, items: { keyword: string }[]) =>
    items.map((c, i) => ({
      ...c,
      id: `cand_${i}`,
      normalized_keyword: c.keyword.trim().toLowerCase().replace(/\s+/g, ' '),
      status: 'candidate',
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
  addCandidates,
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

function candidate(kw: string, score: number) {
  return {
    org_id: 'o1',
    keyword: kw,
    source: 'seed',
    source_context: null,
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
  };
}

describe('strategy worker', () => {
  beforeEach(() => vi.clearAllMocks());

  test('runs pipeline, schedules top candidates, completes', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]); // no existing scheduled keywords
    runKeywordPipeline.mockResolvedValue({
      candidates: [candidate('a', 0.9), candidate('b', 0.8), candidate('rejected', 0.5)].map(
        (c, i) => (i === 2 ? { ...c, rejection_reason: 'serp_intent' } : c),
      ),
      stats: {},
    });

    await handler(event({ org_id: 'o1' }), {} as never, () => {});

    expect(addCandidates).toHaveBeenCalledTimes(1);
    expect(scheduleCandidate).toHaveBeenCalledTimes(2); // rejected one excluded
    // Stored candidates (with ids) are what get scheduled — candidate_id linkage.
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({ id: expect.any(String) });
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
