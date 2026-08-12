import { CandidateSchema, normalizeKeyword } from '@shared/schemas';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { insertMany, persistStrategyMany, scheduledNormalizedSet } = vi.hoisted(() => ({
  insertMany: vi.fn(),
  persistStrategyMany: vi.fn(),
  scheduledNormalizedSet: vi.fn(),
}));

vi.mock('../src/repositories/candidate.repo', () => ({
  CandidateRepo: { insertMany, persistStrategyMany },
}));
vi.mock('../src/repositories/keyword.repo', () => ({
  KeywordRepo: { scheduledNormalizedSet },
}));

import { addCandidates } from '../src/services/add-candidates';
import { persistStrategyCandidates } from '../src/services/persist-strategy-candidates';

describe('candidate persistence services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduledNormalizedSet.mockResolvedValue(new Set());
    insertMany.mockResolvedValue([]);
    persistStrategyMany.mockImplementation(async (orgId: string, items: { keyword: string }[]) =>
      items
        .map((item, index) =>
          CandidateSchema.parse({
            ...item,
            id: `candidate-${index}`,
            org_id: orgId,
            normalized_keyword: normalizeKeyword(item.keyword),
            created_at: new Date('2026-08-01T00:00:00.000Z'),
            updated_at: new Date('2026-08-02T00:00:00.000Z'),
          }),
        )
        .reverse(),
    );
  });

  test('addCandidates remains insert-only', async () => {
    const items = [{ org_id: 'wrong-org', keyword: 'Manual keyword', source: 'manual' as const }];
    const excluded = new Set(['scheduled keyword']);
    scheduledNormalizedSet.mockResolvedValue(excluded);

    await addCandidates('org-1', items);

    expect(insertMany).toHaveBeenCalledWith('org-1', items, { excludeNormalized: excluded });
    expect(persistStrategyMany).not.toHaveBeenCalled();
  });

  test('validates, normalizes, dedupes, excludes scheduled terms, and restores input order', async () => {
    scheduledNormalizedSet.mockResolvedValue(new Set(['scheduled term']));

    const result = await persistStrategyCandidates('org-1', [
      {
        org_id: 'wrong-org',
        keyword: '  Alpha   Topic ',
        source: 'seed',
        opportunity_score: 0.8,
      },
      {
        org_id: 'org-1',
        keyword: 'alpha topic',
        source: 'manual',
        opportunity_score: 0.1,
      },
      { org_id: 'org-1', keyword: 'Scheduled Term', source: 'seed' },
      { org_id: 'org-1', keyword: 'Beta topic', source: 'keyword_suggestions' },
    ]);

    expect(persistStrategyMany).toHaveBeenCalledTimes(1);
    expect(persistStrategyMany.mock.calls[0]![0]).toBe('org-1');
    expect(persistStrategyMany.mock.calls[0]![1]).toEqual([
      expect.objectContaining({
        org_id: 'org-1',
        keyword: '  Alpha   Topic ',
        source: 'seed',
        opportunity_score: 0.8,
        topic_cluster_id: null,
      }),
      expect.objectContaining({
        org_id: 'org-1',
        keyword: 'Beta topic',
        source: 'keyword_suggestions',
      }),
    ]);
    expect(result.map((candidate) => candidate.normalized_keyword)).toEqual([
      'alpha topic',
      'beta topic',
    ]);
    expect(new Set(result.map((candidate) => candidate.normalized_keyword)).size).toBe(2);
  });

  test('rejects invalid input before repository work', async () => {
    await expect(
      persistStrategyCandidates('org-1', [
        {
          org_id: 'org-1',
          keyword: 'invalid metrics',
          source: 'seed',
          search_volume: 1.5,
        },
      ]),
    ).rejects.toThrow();

    expect(scheduledNormalizedSet).not.toHaveBeenCalled();
    expect(persistStrategyMany).not.toHaveBeenCalled();
  });

  test('fails when repository output is incomplete', async () => {
    persistStrategyMany.mockResolvedValue([]);

    await expect(
      persistStrategyCandidates('org-1', [
        { org_id: 'org-1', keyword: 'missing row', source: 'seed' },
      ]),
    ).rejects.toThrow('strategy candidate persistence lost missing row');
  });
});
