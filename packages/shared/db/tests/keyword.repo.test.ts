import { CandidateSchema, KeywordSchema, normalizeKeyword } from '@shared/schemas';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { KeywordRepo } from '../src/repositories/keyword.repo';

function candidate(keyword: string, topic: boolean) {
  return CandidateSchema.parse({
    id: `candidate-${normalizeKeyword(keyword)}`,
    org_id: 'org-topic',
    keyword,
    normalized_keyword: normalizeKeyword(keyword),
    source: 'manual',
    search_volume: 100,
    difficulty: 20,
    topic_cluster_id: topic ? 'topic:membranes' : null,
    topic_cluster_label: topic ? 'Membranes' : null,
    topic_role: topic ? 'support' : null,
    topic_content_focus: topic ? 'How to clean a membrane' : null,
    topic_primary_keyword: topic ? keyword : null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  });
}

describe('KeywordRepo.createFromCandidate', () => {
  afterEach(() => vi.restoreAllMocks());

  test.each([true, false])('copies Candidate topic metadata when topic=%s', async (topic) => {
    const source = candidate(topic ? 'membrane cleaning' : 'manual keyword', topic);
    const create = vi.spyOn(KeywordRepo, 'create').mockImplementation(async (input) =>
      KeywordSchema.parse({
        id: 'keyword-1',
        ...input,
        created_at: new Date('2026-08-12T00:00:00.000Z'),
      }),
    );

    const stored = await KeywordRepo.createFromCandidate(source, '2026-09-01');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_id: source.id,
        topic_cluster_id: source.topic_cluster_id,
        topic_cluster_label: source.topic_cluster_label,
        topic_role: source.topic_role,
        topic_content_focus: source.topic_content_focus,
        topic_primary_keyword: source.topic_primary_keyword,
      }),
    );
    expect(stored).toMatchObject({
      topic_cluster_id: source.topic_cluster_id,
      topic_cluster_label: source.topic_cluster_label,
      topic_role: source.topic_role,
      topic_content_focus: source.topic_content_focus,
      topic_primary_keyword: source.topic_primary_keyword,
    });
  });

  test('copies an unknown difficulty as null (#304)', async () => {
    const source = { ...candidate('niche term', false), difficulty: null };
    vi.spyOn(KeywordRepo, 'create').mockImplementation(async (input) =>
      KeywordSchema.parse({ id: 'keyword-2', ...input, created_at: new Date() }),
    );

    const stored = await KeywordRepo.createFromCandidate(source, '2026-09-01');

    expect(stored.difficulty).toBeNull();
    expect(stored.search_volume).toBe(100);
  });

  test('still refuses a candidate without search volume', async () => {
    const source = { ...candidate('no volume', false), search_volume: null };
    const create = vi.spyOn(KeywordRepo, 'create');

    await expect(KeywordRepo.createFromCandidate(source, '2026-09-01')).rejects.toThrow(
      /search volume/,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
