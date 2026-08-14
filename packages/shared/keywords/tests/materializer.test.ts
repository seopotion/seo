import type { WorkingCandidate } from '@shared/schemas';
import { describe, expect, it } from 'vitest';
import { materializePlan, PlanCoverageError } from '../src/materializer';
import type { PlanResponse, PlanVerdict } from '../src/plan-contract';

// Candidate fixture builder, adapted from filters.test.ts / plan-contract.test.ts's
// candidate fixtures: full WorkingCandidate shape with keyword + opportunity_score set.
const c = (keyword: string, opportunityScore: number | null = 50): WorkingCandidate => ({
  keyword,
  normalized: keyword.toLowerCase(),
  source: 'keywords_for_site',
  source_context: null,
  core_keyword: null,
  category_ids: [],
  topic_cluster_id: null,
  topic_cluster_label: null,
  topic_role: null,
  topic_content_focus: null,
  topic_primary_keyword: null,
  search_volume: 100,
  difficulty: 20,
  cpc: null,
  competition: null,
  trend: null,
  intent: 'informational',
  relevance_score: null,
  opportunity_score: opportunityScore,
  article_type: null,
  rejection_reason: null,
  status: 'candidate',
  serp_competitors: null,
  serp_validated: false,
});

// Verdict helper: one verdict per candidate index, all accepted.
const allOk = (candidates: readonly WorkingCandidate[]): PlanVerdict[] =>
  candidates.map((_c, index) => ({
    index,
    intent_ok: true,
    locality_ok: true,
    article_type: 'other',
  }));

describe('materializePlan', () => {
  it('THE PROD BUG SHAPE: a target grouping keywords under an external primary cannot fail', () => {
    // Prod incident 2026-08-13: model put the "primary" outside member_indices.
    // In the new contract there is no primary field — the same intent arrives as
    // a plain group, and the primary is computed. This must produce a valid plan.
    const candidates = [c('ro fouling', 5), c('membrane fouling', 9), c('fouling ro', 3)];
    const out = materializePlan(
      candidates,
      {
        verdicts: allOk(candidates),
        targets: [
          { cluster: 'fouling', member_indices: [0, 1, 2], content_focus: 'x', is_pillar: true },
        ],
        droppedRows: 0,
      },
      0.5,
    );
    expect(out.accepted).toHaveLength(1);
    expect(out.accepted[0]?.keyword).toBe('membrane fouling'); // highest opportunity wins primary
    expect(out.accepted[0]?.topic_role).toBe('pillar');
    expect(out.rejected.filter((r) => r.rejection_reason === 'topic_duplicate')).toHaveLength(2);
  });

  it('unmentioned accepted candidates become singleton pillar targets', () => {
    const candidates = [c('kw one', 10), c('kw two', 20)];
    const response: PlanResponse = { verdicts: allOk(candidates), targets: [], droppedRows: 0 };
    const out = materializePlan(candidates, response, 0.5);

    expect(out.accepted).toHaveLength(2);
    const clusterIds = new Set(out.accepted.map((a) => a.topic_cluster_id));
    expect(clusterIds.size).toBe(2); // each its own cluster
    for (const a of out.accepted) {
      expect(a.topic_role).toBe('pillar');
    }
    expect(out.coverage.singletons).toBe(2);
    expect(out.coverage.repaired.singleton_created).toBe(2);
  });

  it('out-of-range and duplicate verdict indices are dropped and counted; first verdict wins', () => {
    const candidates = [c('a'), c('b')];
    const response: PlanResponse = {
      verdicts: [
        { index: 0, intent_ok: true, locality_ok: true, article_type: 'other' },
        // duplicate index 0 — dropped, first verdict (intent_ok: true) wins
        { index: 0, intent_ok: false, locality_ok: true, article_type: 'other' },
        { index: 1, intent_ok: true, locality_ok: true, article_type: 'other' },
        // out of range for a 2-candidate pool
        { index: 99, intent_ok: true, locality_ok: true, article_type: 'other' },
      ],
      targets: [],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    expect(out.coverage.repaired.verdict_index_invalid).toBe(1);
    expect(out.coverage.repaired.verdict_duplicate).toBe(1);
    expect(out.accepted.map((a) => a.keyword)).toContain('a');
  });

  it('failed verdicts reject with serp_intent / serp_locality', () => {
    const candidates = [c('bad intent'), c('bad locality'), c('fine')];
    const response: PlanResponse = {
      verdicts: [
        { index: 0, intent_ok: false, locality_ok: true, article_type: 'other' },
        { index: 1, intent_ok: true, locality_ok: false, article_type: 'other' },
        { index: 2, intent_ok: true, locality_ok: true, article_type: 'other' },
      ],
      targets: [],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    const rejByKeyword = new Map(out.rejected.map((r) => [r.keyword, r.rejection_reason]));
    expect(rejByKeyword.get('bad intent')).toBe('serp_intent');
    expect(rejByKeyword.get('bad locality')).toBe('serp_locality');
    expect(out.accepted.map((a) => a.keyword)).toContain('fine');
  });

  it('out-of-range and duplicate member indices are dropped and counted', () => {
    const candidates = [c('only one', 5)];
    const response: PlanResponse = {
      verdicts: allOk(candidates),
      targets: [{ cluster: 'x', member_indices: [0, 0, 99], content_focus: 'y', is_pillar: true }],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    expect(out.accepted).toHaveLength(1);
    expect(out.coverage.repaired.target_index_duplicate).toBe(1);
    expect(out.coverage.repaired.target_index_invalid).toBe(1);
  });

  it('a target whose members were all rejected is dropped', () => {
    const candidates = [c('rejected one'), c('rejected two')];
    const response: PlanResponse = {
      verdicts: [
        { index: 0, intent_ok: false, locality_ok: true, article_type: 'other' },
        { index: 1, intent_ok: false, locality_ok: true, article_type: 'other' },
      ],
      targets: [{ cluster: 'x', member_indices: [0, 1], content_focus: 'y', is_pillar: true }],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    expect(out.coverage.repaired.target_empty).toBe(1);
    expect(out.coverage.repaired.target_member_unaccepted).toBe(2);
    expect(out.accepted).toHaveLength(0);
  });

  it('multiple is_pillar targets in one cluster → highest-opportunity target is pillar, counted', () => {
    const candidates = [c('low', 10), c('high', 20)];
    const response: PlanResponse = {
      verdicts: allOk(candidates),
      targets: [
        { cluster: 'shared', member_indices: [0], content_focus: 'a', is_pillar: true },
        { cluster: 'shared', member_indices: [1], content_focus: 'b', is_pillar: true },
      ],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    const pillar = out.accepted.find((a) => a.topic_role === 'pillar');
    expect(pillar?.keyword).toBe('high');
    expect(out.coverage.repaired.pillar_defaulted).toBe(1);
  });

  it('no is_pillar in a cluster → highest-opportunity target defaults to pillar, counted', () => {
    const candidates = [c('low', 10), c('high', 20)];
    const response: PlanResponse = {
      verdicts: allOk(candidates),
      targets: [
        { cluster: 'shared', member_indices: [0], content_focus: 'a', is_pillar: false },
        { cluster: 'shared', member_indices: [1], content_focus: 'b', is_pillar: false },
      ],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    const pillar = out.accepted.find((a) => a.topic_role === 'pillar');
    expect(pillar?.keyword).toBe('high');
    expect(out.coverage.repaired.pillar_defaulted).toBe(1);
  });

  it('verdict below minCoverage throws PlanCoverageError', () => {
    const candidates = [c('a', 1), c('b', 1), c('c', 1), c('d', 1)];
    expect(() =>
      materializePlan(
        candidates,
        {
          verdicts: [{ index: 0, intent_ok: true, locality_ok: true, article_type: null }],
          targets: [],
          droppedRows: 0,
        },
        0.5,
      ),
    ).toThrow(PlanCoverageError);
  });

  it('unjudged candidates are excluded from accepted/rejected but returned unchanged, and counted', () => {
    const candidates = [c('judged one'), c('judged two'), c('unjudged')];
    const response: PlanResponse = {
      verdicts: [
        { index: 0, intent_ok: true, locality_ok: true, article_type: 'other' },
        { index: 1, intent_ok: true, locality_ok: true, article_type: 'other' },
      ],
      targets: [],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    const keywords = new Set([...out.accepted, ...out.rejected].map((x) => x.keyword));
    expect(keywords.has('unjudged')).toBe(false);
    // Not lost — returned separately, exactly as it entered (never fail-opened
    // into accepted, never rejected without a judged reason).
    expect(out.unjudged.map((x) => x.keyword)).toEqual(['unjudged']);
    expect(out.unjudged[0]).toMatchObject({
      status: 'candidate',
      serp_validated: false,
      rejection_reason: null,
    });
    expect(out.coverage.unjudged).toBe(1);
  });

  it('article_type from the verdict is normalized via toArticleType, invalid → other', () => {
    const candidates = [c('valid type'), c('invalid type')];
    const response: PlanResponse = {
      verdicts: [
        { index: 0, intent_ok: true, locality_ok: true, article_type: 'How-To Guide' },
        { index: 1, intent_ok: true, locality_ok: true, article_type: 'not a real type' },
      ],
      targets: [],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    const byKeyword = new Map(out.accepted.map((a) => [a.keyword, a.article_type]));
    expect(byKeyword.get('valid type')).toBe('how_to_guide');
    expect(byKeyword.get('invalid type')).toBe('other');
  });

  it('cluster id is topic:<normalized pillar primary keyword>', () => {
    const candidates = [c('Membrane Fouling', 9), c('ro fouling', 5)];
    const response: PlanResponse = {
      verdicts: allOk(candidates),
      targets: [
        { cluster: 'fouling', member_indices: [0, 1], content_focus: 'x', is_pillar: true },
      ],
      droppedRows: 0,
    };
    const out = materializePlan(candidates, response, 0.5);

    const pillar = out.accepted.find((a) => a.topic_role === 'pillar');
    expect(pillar?.topic_cluster_id).toBe('topic:membrane fouling');
  });
});
