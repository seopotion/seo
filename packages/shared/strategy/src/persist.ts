import {
  CandidateRepo,
  KeywordRepo,
  OrgRepo,
  persistStrategyCandidates,
  scheduleCandidate,
} from '@shared/db';
import {
  type EnrichedCandidate,
  type StrategyWorkState,
  selectTopicCandidateTargets,
  stampScheduledDates,
  type TopicCandidateTarget,
  toEnriched,
} from '@shared/keywords';
import { type Candidate, normalizeKeyword } from '@shared/schemas';

const PLAN_DAYS = 30;

/** First yyyy-mm-dd on/after `from` not in `occupied` (UTC day steps). */
function nextFreeDate(from: string, occupied: Set<string>): string {
  const d = new Date(`${from}T00:00:00.000Z`);
  let iso = from;
  while (occupied.has(iso)) {
    d.setUTCDate(d.getUTCDate() + 1);
    iso = d.toISOString().slice(0, 10);
  }
  return iso;
}

type SemanticPipelineTarget = EnrichedCandidate & TopicCandidateTarget;

function semanticTargetPool(candidates: readonly EnrichedCandidate[]): SemanticPipelineTarget[] {
  return candidates.filter(
    (candidate) =>
      candidate.serp_validated &&
      candidate.rejection_reason === null &&
      candidate.search_volume !== null &&
      candidate.difficulty !== null,
  ) as SemanticPipelineTarget[];
}

/**
 * Trimmed eligibility gate on the persisted/stored candidate for a target
 * assignment. Replaces the old worker's `isPersistedTargetEligible`, which
 * also field-by-field compared the stored row against the target assignment
 * — dropped here since a stale field just means a stale schedule entry, not
 * an unschedulable one.
 */
function isEligibleStoredCandidate(candidate: Candidate): boolean {
  return (
    (candidate.status === 'candidate' || candidate.status === 'selected') &&
    candidate.rejection_reason === null &&
    candidate.serp_validated &&
    candidate.search_volume !== null &&
    candidate.difficulty !== null
  );
}

export interface PersistScheduleContext {
  orgId: string;
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

/**
 * Persist + schedule stage — the scheduling half of the old worker's
 * `runStrategy`. Persists every candidate the pipeline produced, then
 * schedules up to `PLAN_DAYS` non-overlapping planner entries in semantic
 * topic order (pillar-first, supports gated on a confirmed pillar).
 * Idempotent: a completed org short-circuits without touching anything else.
 * See design/product-flow.md and epic #56.
 */
export async function stagePersistSchedule(
  state: StrategyWorkState,
  ctx: PersistScheduleContext,
): Promise<StrategyWorkState> {
  const { orgId, log } = ctx;

  const org = await OrgRepo.findById(orgId);
  if (org?.strategy_status === 'completed') {
    log?.('strategy already completed; skipping');
    return state;
  }

  const allCandidates = [...state.candidates, ...state.belowN, ...state.rejected].map((c) =>
    toEnriched(c, orgId),
  );

  const scheduled = await KeywordRepo.listByOrg(orgId);

  const targetPool = semanticTargetPool(allCandidates);
  const orderedTargets = selectTopicCandidateTargets(targetPool, targetPool.length);

  const persisted = await persistStrategyCandidates(orgId, allCandidates);
  const storedByNormalized = new Map(persisted.map((c) => [c.normalized_keyword, c]));

  const scheduledSet = new Set(scheduled.map((k) => normalizeKeyword(k.keyword)));
  // Strategy entries this job wrote carry a non-null opportunity_score; manual #50
  // selections go to the candidate pool (not KeywordRepo), so this proxy counts
  // only prior strategy output. Budget the remaining 30-day plan against them and
  // offset the start date so a redelivered partial run neither exceeds PLAN_DAYS
  // nor collides calendar dates with already-created entries.
  const alreadyScheduled = scheduled.filter((k) => k.opportunity_score !== null).length;
  const budget = Math.max(0, PLAN_DAYS - alreadyScheduled);
  const confirmedTopicClusters = new Set<string>();
  for (const keyword of scheduled) {
    if (
      keyword.topic_role === 'pillar' &&
      keyword.topic_cluster_id !== null &&
      keyword.topic_cluster_id.trim().length > 0
    ) {
      confirmedTopicClusters.add(keyword.topic_cluster_id);
    }
  }

  // Start tomorrow (UTC): the generation cron runs at 07:00 UTC, so a plan
  // stamped "today" for an org finalized after that hour has a day-1 slot
  // already in the past, and listDueForGeneration catches days 1 and 2 up
  // together the next morning (#292). Offset further by what a redelivered
  // partial run already scheduled.
  const startDay = new Date();
  startDay.setUTCDate(startDay.getUTCDate() + 1 + alreadyScheduled);
  const occupied = new Set(scheduled.map((k) => k.scheduled_date));
  let qualifiedCount = 0;
  let scheduledCount = 0;

  for (const target of orderedTargets) {
    const normalized = normalizeKeyword(target.keyword);
    if (scheduledSet.has(normalized)) {
      if (target.topic_role === 'pillar') confirmedTopicClusters.add(target.topic_cluster_id);
      continue;
    }
    if (scheduledCount >= budget) break;

    const stored =
      storedByNormalized.get(normalized) ??
      (await CandidateRepo.findByNormalized(orgId, normalized));
    if (!stored || !isEligibleStoredCandidate(stored)) continue;
    if (target.topic_role === 'support' && !confirmedTopicClusters.has(target.topic_cluster_id)) {
      continue;
    }

    qualifiedCount++;
    const slotStart = new Date(startDay);
    slotStart.setUTCDate(slotStart.getUTCDate() + scheduledCount);
    const entry = stampScheduledDates([stored], slotStart, 1)[0] as {
      item: Candidate;
      scheduled_date: string;
    };
    let date = nextFreeDate(entry.scheduled_date, occupied);
    let res = await scheduleCandidate(entry.item, date);
    if (!res.ok && res.reason === 'date_occupied') {
      // Lost a race for the date: mark it taken and try the next free one.
      occupied.add(date);
      date = nextFreeDate(date, occupied);
      res = await scheduleCandidate(entry.item, date);
    }
    if (res.ok) {
      occupied.add(res.keyword.scheduled_date);
      scheduledCount++;
      if (target.topic_role === 'pillar') confirmedTopicClusters.add(target.topic_cluster_id);
    } else {
      if (res.reason === 'date_occupied') occupied.add(date);
      log?.('strategy schedule skipped', { keyword: entry.item.keyword, reason: res.reason });
    }
  }

  // A short plan is the correct outcome when the pipeline validated fewer than
  // `budget` usable semantic targets — padding it from the unvalidated tier is
  // what put junk on the planner (#211). Log the shortfall so it is visible.
  if (scheduledCount < budget) {
    log?.('strategy plan under-filled', {
      requested: budget,
      qualified: qualifiedCount,
      shortfall: budget - scheduledCount,
    });
  }

  await OrgRepo.setStrategyStatus(orgId, 'completed');
  log?.('strategy completed', {
    requested: budget,
    qualified: qualifiedCount,
    scheduled: scheduledCount,
  });

  return state;
}
