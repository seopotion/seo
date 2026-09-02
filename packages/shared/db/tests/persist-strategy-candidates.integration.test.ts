import { normalizeKeyword } from '@shared/schemas';
import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { getDb } from '../src/client';
import { ensureIndexes } from '../src/ensure-indexes';
import { CandidateRepo } from '../src/repositories/candidate.repo';
import { addCandidates } from '../src/services/add-candidates';
import { persistStrategyCandidates } from '../src/services/persist-strategy-candidates';

const ORG = 'org_strategy_persistence';
const OTHER_ORG = 'org_strategy_persistence_other';

function strategyCandidate(keyword: string, over: Record<string, unknown> = {}) {
  return {
    org_id: ORG,
    keyword,
    source: 'seed' as const,
    core_keyword: 'membrane fouling',
    category_ids: [11, 22],
    search_volume: 900,
    difficulty: 27,
    cpc: 4.2,
    competition: 0.6,
    trend: 0.4,
    intent: 'informational' as const,
    relevance_score: 0.91,
    opportunity_score: 0.84,
    article_type: 'how_to_guide' as const,
    serp_competitors: [
      {
        rank: 1,
        url: 'https://example.test/fouling',
        domain: 'example.test',
        title: 'Membrane fouling',
      },
    ],
    serp_validated: true,
    topic_cluster_id: 'topic:membrane fouling',
    topic_cluster_label: 'Membrane fouling',
    topic_role: 'pillar' as const,
    topic_content_focus: 'What membrane fouling is and why it occurs',
    topic_primary_keyword: 'membrane fouling',
    status: 'candidate' as const,
    rejection_reason: null,
    ...over,
  };
}

describe('persistStrategyCandidates (integration)', () => {
  beforeAll(async () => {
    await ensureIndexes();
  });

  beforeEach(async () => {
    const db = await getDb();
    await db.collection('candidates').deleteMany({ org_id: { $in: [ORG, OTHER_ORG] } });
    await db.collection('keywords').deleteMany({ org_id: { $in: [ORG, OTHER_ORG] } });
  });

  test('addCandidates stays insert-only and does not refresh an existing manual row', async () => {
    const [original] = await addCandidates(ORG, [
      {
        org_id: ORG,
        keyword: 'Manual Research',
        source: 'manual',
        opportunity_score: 0.2,
      },
    ]);

    const inserted = await addCandidates(ORG, [
      {
        org_id: ORG,
        keyword: 'manual   research',
        source: 'seed',
        opportunity_score: 0.9,
      },
      { org_id: ORG, keyword: 'New manual row', source: 'manual' },
    ]);

    expect(inserted.map((candidate) => candidate.keyword)).toEqual(['New manual row']);
    const unchanged = await CandidateRepo.findByNormalized(ORG, 'manual research');
    expect(unchanged).toMatchObject({
      id: original!.id,
      keyword: 'Manual Research',
      source: 'manual',
      opportunity_score: 0.2,
    });
  });

  test('refreshes strategy fields while preserving identity and rejecting a new duplicate', async () => {
    const [original] = await CandidateRepo.insertMany(ORG, [
      {
        org_id: ORG,
        keyword: 'Membrane Fouling',
        source: 'manual',
        source_context: 'manual research',
        search_volume: 10,
        opportunity_score: 0.1,
      },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const [refreshed] = await persistStrategyCandidates(ORG, [
      strategyCandidate('membrane   fouling', {
        status: 'rejected',
        rejection_reason: 'topic_duplicate',
        topic_role: 'support',
        topic_primary_keyword: 'membrane fouling causes',
      }),
    ]);

    expect(refreshed).toMatchObject({
      id: original!.id,
      org_id: ORG,
      normalized_keyword: 'membrane fouling',
      keyword: 'Membrane Fouling',
      source: 'manual',
      source_context: 'manual research',
      core_keyword: 'membrane fouling',
      category_ids: [11, 22],
      search_volume: 900,
      difficulty: 27,
      cpc: 4.2,
      competition: 0.6,
      trend: 0.4,
      intent: 'informational',
      relevance_score: 0.91,
      opportunity_score: 0.84,
      article_type: 'how_to_guide',
      serp_validated: true,
      topic_cluster_id: 'topic:membrane fouling',
      topic_cluster_label: 'Membrane fouling',
      topic_role: 'support',
      topic_content_focus: 'What membrane fouling is and why it occurs',
      topic_primary_keyword: 'membrane fouling causes',
      status: 'rejected',
      rejection_reason: 'topic_duplicate',
    });
    expect(refreshed!.serp_competitors).toEqual(strategyCandidate('x').serp_competitors);
    expect(refreshed!.created_at).toEqual(original!.created_at);
    expect(refreshed!.updated_at.getTime()).toBeGreaterThan(original!.updated_at.getTime());
  });

  test('returns new and existing accepted rows in normalized input order', async () => {
    const [existing] = await CandidateRepo.insertMany(ORG, [
      { org_id: ORG, keyword: 'Existing Primary', source: 'manual' },
    ]);

    const persisted = await persistStrategyCandidates(ORG, [
      strategyCandidate('New Primary'),
      strategyCandidate('existing primary', { topic_role: 'support' }),
      strategyCandidate(' new   primary ', { opportunity_score: 0.01 }),
    ]);

    expect(persisted.map((candidate) => candidate.normalized_keyword)).toEqual([
      'new primary',
      'existing primary',
    ]);
    expect(persisted[0]!.id).toMatch(/^[a-f0-9]{24}$/);
    expect(persisted[0]!.opportunity_score).toBe(0.84);
    expect(persisted[1]).toMatchObject({
      id: existing!.id,
      keyword: 'Existing Primary',
      status: 'candidate',
      rejection_reason: null,
      serp_validated: true,
      topic_cluster_id: 'topic:membrane fouling',
      topic_role: 'support',
    });
  });

  test('preserves operator decisions (selected, admin-rejected) while refreshing topic metadata', async () => {
    const [selected] = await CandidateRepo.insertMany(ORG, [
      { org_id: ORG, keyword: 'Selected topic', source: 'manual' },
    ]);
    await CandidateRepo.claimForScheduling(selected!.id);
    // An admin reject carries no rejection_reason (CandidateRepo.rejectIfCandidate).
    const [adminRejected] = await CandidateRepo.insertMany(ORG, [
      { org_id: ORG, keyword: 'Admin rejected topic', source: 'manual', status: 'rejected' },
    ]);

    const persisted = await persistStrategyCandidates(ORG, [
      strategyCandidate('selected topic', {
        topic_cluster_id: 'topic:current selected',
        status: 'rejected',
        rejection_reason: 'topic_duplicate',
      }),
      strategyCandidate('admin rejected topic', { topic_cluster_id: 'topic:current rejected' }),
    ]);

    expect(persisted[0]).toMatchObject({
      id: selected!.id,
      status: 'selected',
      rejection_reason: null,
      topic_cluster_id: 'topic:current selected',
      opportunity_score: 0.84,
    });
    expect(persisted[1]).toMatchObject({
      id: adminRejected!.id,
      status: 'rejected',
      rejection_reason: null,
      topic_cluster_id: 'topic:current rejected',
      opportunity_score: 0.84,
    });
  });

  test("a rerun refreshes an earlier run's rejection so the keyword can be scheduled (#301)", async () => {
    const [first] = await persistStrategyCandidates(ORG, [
      strategyCandidate('virtual fitting room', {
        status: 'rejected',
        rejection_reason: 'serp_intent',
      }),
    ]);
    expect(first).toMatchObject({ status: 'rejected', rejection_reason: 'serp_intent' });

    const [second] = await persistStrategyCandidates(ORG, [
      strategyCandidate('virtual fitting room', { topic_cluster_id: 'topic:rerun' }),
    ]);
    expect(second).toMatchObject({
      id: first!.id,
      status: 'candidate',
      rejection_reason: null,
      topic_cluster_id: 'topic:rerun',
    });

    // A rerun that rejects again records the new reason, not the old one.
    const [third] = await persistStrategyCandidates(ORG, [
      strategyCandidate('virtual fitting room', {
        status: 'rejected',
        rejection_reason: 'topic_duplicate',
      }),
    ]);
    expect(third).toMatchObject({
      id: first!.id,
      status: 'rejected',
      rejection_reason: 'topic_duplicate',
    });
  });

  test('excludes scheduled keywords and keeps persistence org-scoped', async () => {
    const db = await getDb();
    await db.collection('keywords').insertOne({
      org_id: ORG,
      keyword: 'Already Scheduled',
      normalized_keyword: normalizeKeyword('Already Scheduled'),
    });
    const [otherOrg] = await CandidateRepo.insertMany(OTHER_ORG, [
      {
        org_id: OTHER_ORG,
        keyword: 'Shared Topic',
        source: 'manual',
        opportunity_score: 0.1,
      },
    ]);

    const persisted = await persistStrategyCandidates(ORG, [
      strategyCandidate('Already Scheduled'),
      strategyCandidate('Shared Topic'),
    ]);

    expect(persisted.map((candidate) => candidate.normalized_keyword)).toEqual(['shared topic']);
    expect(persisted[0]!.org_id).toBe(ORG);
    expect(persisted[0]!.id).not.toBe(otherOrg!.id);
    expect((await CandidateRepo.findById(otherOrg!.id))!.opportunity_score).toBe(0.1);
    expect(await CandidateRepo.findByNormalized(ORG, 'already scheduled')).toBeNull();
  });
});
