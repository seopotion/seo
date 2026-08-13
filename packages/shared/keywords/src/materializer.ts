import { normalizeKeyword, type WorkingCandidate } from '@shared/schemas';
import { reject } from './filters';
import { toArticleType } from './llm-prompts';
import type { PlanResponse, PlanVerdict } from './plan-contract';

export const PLAN_REPAIR_KINDS = [
  'verdict_index_invalid',
  'verdict_duplicate',
  'target_index_invalid',
  'target_index_duplicate',
  'target_member_unaccepted',
  'target_empty',
  'pillar_defaulted',
  'singleton_created',
] as const;
export type PlanRepairKind = (typeof PLAN_REPAIR_KINDS)[number];

export interface PlanCoverage {
  finalists: number;
  verdicts: number;
  unjudged: number;
  accepted: number;
  targets: number;
  clusters: number;
  singletons: number;
  duplicates: number;
  pillars: number;
  supports: number;
  repaired: Record<PlanRepairKind, number>;
  repairRetried: boolean;
}

/** Too few verdicts to trust the call — triggers the repair retry (#211). */
export class PlanCoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanCoverageError';
  }
}

interface BuiltTarget {
  cluster: string;
  members: number[];
  primary: number;
  content_focus: string;
  is_pillar: boolean;
}

function emptyRepairs(): Record<PlanRepairKind, number> {
  return Object.fromEntries(PLAN_REPAIR_KINDS.map((k) => [k, 0])) as Record<PlanRepairKind, number>;
}

/** Highest opportunity wins; null scores last; ties → lowest index (stable). */
function pickPrimary(members: number[], candidates: readonly WorkingCandidate[]): number {
  return [...members].sort((a, b) => {
    const sa = candidates[a]?.opportunity_score ?? null;
    const sb = candidates[b]?.opportunity_score ?? null;
    if (sa === null) return sb === null ? a - b : 1;
    if (sb === null) return -1;
    return sb - sa || a - b;
  })[0] as number;
}

/**
 * Build the strict plan structure FROM the model's forgiving output. Every
 * invariant the old validator threw on is either unrepresentable here or made
 * true by construction; slips become counted repairs, never failures. The one
 * exception is verdict coverage — a mostly-unjudged pool must not silently ship
 * as a mostly-singleton plan (#211), so that throws PlanCoverageError.
 */
export function materializePlan(
  candidates: readonly WorkingCandidate[],
  response: PlanResponse,
  minCoverage: number,
): { accepted: WorkingCandidate[]; rejected: WorkingCandidate[]; coverage: PlanCoverage } {
  const repaired = emptyRepairs();

  // 1. Verdicts by index — first row wins, invalid indexes dropped.
  const verdicts = new Map<number, PlanVerdict>();
  for (const v of response.verdicts) {
    if (v.index < 0 || v.index >= candidates.length) {
      repaired.verdict_index_invalid++;
      continue;
    }
    if (verdicts.has(v.index)) {
      repaired.verdict_duplicate++;
      continue;
    }
    verdicts.set(v.index, v);
  }
  if (candidates.length > 0 && verdicts.size / candidates.length < minCoverage) {
    throw new PlanCoverageError(
      `plan call judged ${verdicts.size}/${candidates.length} finalists ` +
        `(minLlmCoverage ${Math.round(minCoverage * 100)}%); return one verdict per index`,
    );
  }

  // 2. Apply verdicts: accepted set + intent/locality rejects; unjudged excluded.
  const acceptedIdx = new Set<number>();
  const rejected: WorkingCandidate[] = [];
  let unjudged = 0;
  candidates.forEach((c, i) => {
    const v = verdicts.get(i);
    if (v === undefined) {
      unjudged++;
      return;
    }
    if (!v.intent_ok) rejected.push(reject(c, 'serp_intent'));
    else if (!v.locality_ok) rejected.push(reject(c, 'serp_locality'));
    else acceptedIdx.add(i);
  });

  // 3. Targets: sanitize members (first target claims an index).
  const claimed = new Set<number>();
  const built: BuiltTarget[] = [];
  for (const t of response.targets) {
    const members: number[] = [];
    for (const idx of t.member_indices) {
      if (idx < 0 || idx >= candidates.length) {
        repaired.target_index_invalid++;
        continue;
      }
      if (!acceptedIdx.has(idx)) {
        repaired.target_member_unaccepted++;
        continue;
      }
      if (claimed.has(idx)) {
        repaired.target_index_duplicate++;
        continue;
      }
      claimed.add(idx);
      members.push(idx);
    }
    if (members.length === 0) {
      repaired.target_empty++;
      continue;
    }
    built.push({
      cluster: t.cluster.trim() || (candidates[members[0] as number] as WorkingCandidate).keyword,
      members,
      primary: pickPrimary(members, candidates),
      content_focus: t.content_focus.trim(),
      is_pillar: t.is_pillar,
    });
  }

  // 4. Singletons: accepted candidates the model left out of every target.
  let singletons = 0;
  for (const idx of acceptedIdx) {
    if (claimed.has(idx)) continue;
    const c = candidates[idx] as WorkingCandidate;
    built.push({
      cluster: c.keyword,
      members: [idx],
      primary: idx,
      content_focus: '',
      is_pillar: false,
    });
    singletons++;
    repaired.singleton_created++;
  }

  // 5. Clusters: group by label; resolve exactly one pillar target per cluster.
  const byCluster = new Map<string, BuiltTarget[]>();
  for (const t of built) {
    const list = byCluster.get(t.cluster) ?? [];
    list.push(t);
    byCluster.set(t.cluster, list);
  }
  const accepted: WorkingCandidate[] = [];
  let duplicates = 0;
  let pillars = 0;
  let supports = 0;
  for (const [label, targets] of byCluster) {
    const flagged = targets.filter((t) => t.is_pillar);
    let pillar: BuiltTarget;
    if (flagged.length === 1) {
      pillar = flagged[0] as BuiltTarget;
    } else {
      // Zero or several pillar flags — default deterministically, count it
      // (except the trivial single-target cluster, where there is no choice).
      pillar = targets[pickTargetIndexByOpportunity(targets, candidates)] as BuiltTarget;
      if (targets.length > 1 || flagged.length > 1) repaired.pillar_defaulted++;
    }
    const pillarPrimary = candidates[pillar.primary] as WorkingCandidate;
    const clusterId = `topic:${normalizeKeyword(pillarPrimary.keyword)}`;
    for (const t of targets) {
      const role = t === pillar ? 'pillar' : 'support';
      if (role === 'pillar') pillars++;
      else supports++;
      const primaryCandidate = candidates[t.primary] as WorkingCandidate;
      const focus = t.content_focus || primaryCandidate.keyword;
      for (const idx of t.members) {
        const c = candidates[idx] as WorkingCandidate;
        const v = verdicts.get(idx) as PlanVerdict;
        const stamped: WorkingCandidate = {
          ...c,
          topic_cluster_id: clusterId,
          topic_cluster_label: label,
          topic_role: role,
          topic_content_focus: focus,
          topic_primary_keyword: primaryCandidate.keyword,
          article_type: (v.article_type !== null ? toArticleType(v.article_type) : null) ?? 'other',
          serp_validated: true,
        };
        if (idx === t.primary) accepted.push(stamped);
        else {
          rejected.push(reject(stamped, 'topic_duplicate'));
          duplicates++;
        }
      }
    }
  }

  return {
    accepted,
    rejected,
    coverage: {
      finalists: candidates.length,
      verdicts: verdicts.size,
      unjudged,
      accepted: acceptedIdx.size,
      targets: built.length,
      clusters: byCluster.size,
      singletons,
      duplicates,
      pillars,
      supports,
      repaired,
      repairRetried: false,
    },
  };
}

function pickTargetIndexByOpportunity(
  targets: BuiltTarget[],
  candidates: readonly WorkingCandidate[],
): number {
  let best = 0;
  let bestScore = -Infinity;
  targets.forEach((t, i) => {
    const s = candidates[t.primary]?.opportunity_score ?? -Infinity;
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return best;
}
