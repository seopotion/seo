import type { SQSEvent } from 'aws-lambda';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { findById, setStrategyStatus, addCandidates, createKeyword, listByOrg, setStatus } =
  vi.hoisted(() => ({
    findById: vi.fn(),
    setStrategyStatus: vi.fn(async () => {}),
    addCandidates: vi.fn(async () => []),
    createKeyword: vi.fn(async () => ({})),
    listByOrg: vi.fn(async () => []),
    setStatus: vi.fn(async () => {}),
  }));
vi.mock('@shared/db', () => ({
  OrgRepo: { findById, setStrategyStatus },
  KeywordRepo: { create: createKeyword, listByOrg },
  CandidateRepo: { findByNormalized: vi.fn(async () => null), setStatus },
  addCandidates,
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
    audience: { target: 'devs', competitors: [] },
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
    serp_competitors: ['a.com'],
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
    expect(createKeyword).toHaveBeenCalledTimes(2); // rejected one excluded
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'completed');
  });

  test('skips when already completed (idempotent)', async () => {
    findById.mockResolvedValue({ ...org, strategy_status: 'completed' });
    await handler(event({ org_id: 'o1' }), {} as never, () => {});
    expect(runKeywordPipeline).not.toHaveBeenCalled();
    expect(createKeyword).not.toHaveBeenCalled();
  });

  test('marks failed and rethrows on pipeline error', async () => {
    findById.mockResolvedValue(org);
    runKeywordPipeline.mockRejectedValue(new Error('provider down'));
    await expect(handler(event({ org_id: 'o1' }), {} as never, () => {})).rejects.toThrow(
      'provider down',
    );
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'failed');
  });
});
