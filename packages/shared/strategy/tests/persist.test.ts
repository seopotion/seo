import type { WorkingCandidate } from '@shared/schemas';
import { normalizeKeyword } from '@shared/schemas';
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

import { stagePersistSchedule } from '../src/persist';

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
    serp_validated: boolean;
    status: string;
    rejection_reason: string | null;
  }> = {},
): WorkingCandidate {
  const normalized = normalizeKeyword(kw);
  return {
    keyword: kw,
    normalized,
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
  } as WorkingCandidate;
}

function state(candidates: WorkingCandidate[]) {
  return { candidates, belowN: [], rejected: [], seeds: [], stats: {} };
}

describe('stagePersistSchedule', () => {
  beforeEach(() => vi.clearAllMocks());

  test('schedules cluster pillars first, then drains supports round-robin', async () => {
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

    await stagePersistSchedule(state(candidates), { orgId: 'o1' });

    expect(scheduleCandidate.mock.calls.map(([row]) => row.keyword)).toEqual([
      'A pillar',
      'B pillar',
      'A support high',
      'B support',
      'A support low',
    ]);
  });

  test('a support target is skipped while its pillar is unconfirmed', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const pillar = candidate('Failed pillar', 100, {
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
    scheduleCandidate.mockResolvedValueOnce({
      ok: false,
      reason: 'candidate_not_schedulable',
    } as never);

    await stagePersistSchedule(state([pillar, blockedSupport, laterPillar, laterSupport]), {
      orgId: 'o1',
    });

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

  test('a date_occupied race is retried once, then the entry is skipped on a second loss', async () => {
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
    scheduleCandidate
      .mockResolvedValueOnce({ ok: false, reason: 'date_occupied' } as never)
      .mockResolvedValueOnce({ ok: false, reason: 'date_occupied' } as never);

    await stagePersistSchedule(state([pillar, support]), { orgId: 'o1' });

    expect(scheduleCandidate).toHaveBeenCalledTimes(2);
    expect(scheduleCandidate.mock.calls[0]![0]).toMatchObject({ keyword: 'Race-losing pillar' });
    expect(scheduleCandidate.mock.calls[1]![0]).toMatchObject({ keyword: 'Race-losing pillar' });
    expect(scheduleCandidate.mock.calls[1]![1]).not.toBe(scheduleCandidate.mock.calls[0]![1]);
    expect(scheduleCandidate).not.toHaveBeenCalledWith(
      expect.objectContaining({ keyword: 'Blocked race support' }),
      expect.any(String),
    );
  });

  test('a cluster whose pillar-primary has a null metric drops its support instead of throwing (final-review finding 1)', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    // The pillar itself gets filtered out of the semantic target pool (null
    // difficulty fails semanticTargetPool's metric check), but its same-cluster
    // support survives the pool filter — this used to make selectionClusters
    // throw TopicClusterValidationError, retry-forever at the last stage.
    const orphanedPillar: WorkingCandidate = {
      ...candidate('Orphan pillar', 100, {
        topic_cluster_id: 'topic:orphan',
        topic_cluster_label: 'Orphan',
      }),
      difficulty: null,
    };
    const orphanedSupport = candidate('Orphan support', 90, {
      topic_cluster_id: 'topic:orphan',
      topic_cluster_label: 'Orphan',
      topic_role: 'support',
    });
    const healthyPillar = candidate('Healthy pillar', 80, {
      topic_cluster_id: 'topic:healthy',
      topic_cluster_label: 'Healthy',
    });
    const healthySupport = candidate('Healthy support', 70, {
      topic_cluster_id: 'topic:healthy',
      topic_cluster_label: 'Healthy',
      topic_role: 'support',
    });

    await expect(
      stagePersistSchedule(
        state([orphanedPillar, orphanedSupport, healthyPillar, healthySupport]),
        { orgId: 'o1' },
      ),
    ).resolves.toBeDefined();

    expect(scheduleCandidate.mock.calls.map(([row]) => row.keyword)).toEqual([
      'Healthy pillar',
      'Healthy support',
    ]);
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'completed');
  });

  test('under-fills the plan rather than padding it, logs the shortfall, and still completes', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const candidates = Array.from({ length: 3 }, (_, i) => candidate(`k${i}`, 0.9 - i * 0.1));
    const log = vi.fn();

    await stagePersistSchedule(state(candidates), { orgId: 'o1', log });

    expect(scheduleCandidate).toHaveBeenCalledTimes(3); // 3, not PLAN_DAYS(30)
    expect(log).toHaveBeenCalledWith(
      'strategy plan under-filled',
      expect.objectContaining({ requested: 30, qualified: 3, shortfall: 27 }),
    );
    expect(setStrategyStatus).toHaveBeenCalledWith('o1', 'completed');
  });

  test('a completed org short-circuits: no persist, no scheduling, no status write', async () => {
    findById.mockResolvedValue({ ...org, strategy_status: 'completed' });
    const log = vi.fn();
    const input = state([candidate('a', 0.9)]);

    const result = await stagePersistSchedule(input, { orgId: 'o1', log });

    expect(result).toBe(input);
    expect(persistStrategyCandidates).not.toHaveBeenCalled();
    expect(scheduleCandidate).not.toHaveBeenCalled();
    expect(setStrategyStatus).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('strategy already completed; skipping');
  });

  test('setStrategyStatus(completed) is the last repository call once scheduling finishes', async () => {
    findById.mockResolvedValue(org);
    listByOrg.mockResolvedValue([]);
    const calls: string[] = [];
    persistStrategyCandidates.mockImplementationOnce(async (_orgId, items) => {
      calls.push('persist');
      return (items as { keyword: string }[]).map((c, i) => ({
        ...c,
        id: `cand_${i}`,
        normalized_keyword: c.keyword.trim().toLowerCase().replace(/\s+/g, ' '),
      }));
    });
    scheduleCandidate.mockImplementation(async (cand: { id: string; keyword: string }, d) => {
      calls.push('schedule');
      return {
        ok: true,
        created: true,
        keyword: { id: `kw_${cand.id}`, candidate_id: cand.id, scheduled_date: d },
      };
    });
    setStrategyStatus.mockImplementation(async () => {
      calls.push('status');
    });

    await stagePersistSchedule(state([candidate('a', 0.9)]), { orgId: 'o1' });

    expect(calls[calls.length - 1]).toBe('status');
    expect(calls).toContain('persist');
    expect(calls).toContain('schedule');
  });

  test('starts the plan on the next UTC day so day 1 is never behind the 07:00 UTC cron (#292)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T14:08:00.000Z'));
    try {
      findById.mockResolvedValue(org);
      listByOrg.mockResolvedValue([]);
      const candidates = [candidate('first', 90), candidate('second', 80)];

      await stagePersistSchedule(state(candidates), { orgId: 'o1' });

      expect(scheduleCandidate.mock.calls.map(([, date]) => date)).toEqual([
        '2026-09-02',
        '2026-09-03',
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  test('a top-up still offsets by the entries already scheduled, counted from tomorrow', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-01T23:59:00.000Z'));
    try {
      findById.mockResolvedValue(org);
      listByOrg.mockResolvedValue([
        {
          keyword: 'old a',
          opportunity_score: 50,
          scheduled_date: '2026-09-10',
          topic_role: 'pillar',
          topic_cluster_id: 'topic:old a',
        },
        {
          keyword: 'old b',
          opportunity_score: 40,
          scheduled_date: '2026-09-11',
          topic_role: 'pillar',
          topic_cluster_id: 'topic:old b',
        },
      ] as never);

      await stagePersistSchedule(state([candidate('new', 90)]), { orgId: 'o1' });

      expect(scheduleCandidate.mock.calls[0]![1]).toBe('2026-09-04');
    } finally {
      vi.useRealTimers();
    }
  });
});
