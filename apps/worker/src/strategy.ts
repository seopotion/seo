import {
  CandidateRepo,
  KeywordRepo,
  OrgRepo,
  persistStrategyCandidates,
  scheduleCandidate,
} from '@shared/db';
import {
  type EnrichedCandidate,
  runKeywordPipeline,
  selectTopicCandidateTargets,
  stampScheduledDates,
  type TopicCandidateTarget,
} from '@shared/keywords';
import { type Candidate, normalizeKeyword, StrategyTask } from '@shared/schemas';
import type { Context, SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getStrategyClients } from './providers';

const PLAN_DAYS = 30;

// A hard Lambda timeout can't be caught, so it would leave the org stuck in a
// non-terminal strategy_status (the catch below never runs). Abort a bit before
// the ceiling instead, leaving room to mark the org failed and rethrow so SQS
// redelivers. Absent a Lambda context (local/dev/tests) there is no deadline.
const DEADLINE_BUFFER_MS = 20_000;

async function withDeadline<T>(context: Context | undefined, fn: () => Promise<T>): Promise<T> {
  const remaining = context?.getRemainingTimeInMillis?.();
  if (remaining === undefined) return fn();
  const budgetMs = Math.max(0, remaining - DEADLINE_BUFFER_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`strategy aborted: approaching Lambda timeout (${budgetMs}ms budget)`)),
      budgetMs,
    );
  });
  try {
    return await Promise.race([fn(), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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

function isPersistedTargetEligible(
  candidate: Candidate,
  assignment: SemanticPipelineTarget,
): boolean {
  if (
    (candidate.status !== 'candidate' && candidate.status !== 'selected') ||
    candidate.rejection_reason !== null ||
    !candidate.serp_validated ||
    candidate.search_volume === null ||
    candidate.difficulty === null ||
    candidate.topic_cluster_id === null ||
    candidate.topic_cluster_id.trim().length === 0 ||
    candidate.topic_cluster_label === null ||
    candidate.topic_cluster_label.trim().length === 0 ||
    candidate.topic_role === null ||
    candidate.topic_content_focus === null ||
    candidate.topic_content_focus.trim().length === 0 ||
    candidate.topic_primary_keyword === null ||
    normalizeKeyword(candidate.keyword).length === 0 ||
    normalizeKeyword(candidate.topic_primary_keyword) !== normalizeKeyword(candidate.keyword)
  ) {
    return false;
  }

  return (
    normalizeKeyword(candidate.keyword) === normalizeKeyword(assignment.keyword) &&
    candidate.topic_cluster_id === assignment.topic_cluster_id &&
    candidate.topic_cluster_label === assignment.topic_cluster_label &&
    candidate.topic_role === assignment.topic_role &&
    candidate.topic_content_focus === assignment.topic_content_focus &&
    normalizeKeyword(candidate.topic_primary_keyword) ===
      normalizeKeyword(assignment.topic_primary_keyword)
  );
}

/**
 * Strategy worker — triggered by SQS (enqueued from POST /setup/finalize for
 * paid orgs). Runs the keyword pipeline, persists candidates, and schedules up
 * to 30 non-overlapping planner entries in semantic topic order. Idempotent:
 * skips if already completed; on failure marks the org and rethrows so SQS
 * redelivers (-> DLQ). See design/product-flow.md and epic #56.
 */
async function runStrategy(orgId: string): Promise<void> {
  const org = await OrgRepo.findById(orgId);
  if (!org?.presets) {
    logger.warn('strategy skipped: org or presets missing');
    return;
  }
  if (org.strategy_status === 'completed') {
    logger.info('strategy already completed; skipping');
    return;
  }

  const clients = await getStrategyClients();
  const scheduled = await KeywordRepo.listByOrg(orgId);
  const scheduledKeywords = scheduled.map((k) => k.keyword);
  // Generated Articles retain source Keywords already included in scheduledKeywords.
  const articleKeywords: string[] = [];

  const result = await runKeywordPipeline({
    orgId,
    websiteUrl: org.website_url,
    presets: org.presets,
    competitors: org.presets.audience.competitors,
    existingKeywords: scheduledKeywords,
    existingArticleKeywords: articleKeywords,
    clients,
    onProgress: (stage, meta) => logger.info('strategy stage', { stage, ...meta }),
  });

  // Funnel counts per run, including the three LLM coverage blocks and the seeds
  // the pool was built from. Relevance and the SERP judge now ABORT below
  // config.minLlmCoverage — they degrade in ways that still produce a full,
  // plausible plan, so the run never reaches this line when either has failed.
  // Classify is only reported: an unanswered keyword becomes `other`, which
  // weakens its content brief but never schedules the wrong keyword (#211).
  logger.info('strategy pipeline stats', { ...result.stats });

  const targetPool = semanticTargetPool(result.candidates);
  const orderedTargets = selectTopicCandidateTargets(targetPool, targetPool.length);

  const persisted = await persistStrategyCandidates(orgId, result.candidates);
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

  const startDay = new Date();
  startDay.setUTCDate(startDay.getUTCDate() + alreadyScheduled);
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
    if (!stored || !isPersistedTargetEligible(stored, target)) continue;
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
      logger.info('strategy schedule skipped', { keyword: entry.item.keyword, reason: res.reason });
    }
  }

  // A short plan is the correct outcome when the pipeline validated fewer than
  // `budget` usable semantic targets — padding it from the unvalidated tier is
  // what put junk on the planner (#211). Log the shortfall so it is visible.
  if (scheduledCount < budget) {
    logger.warn('strategy plan under-filled', {
      requested: budget,
      qualified: qualifiedCount,
      shortfall: budget - scheduledCount,
    });
  }

  await OrgRepo.setStrategyStatus(orgId, 'completed');
  logger.info('strategy completed', {
    requested: budget,
    qualified: qualifiedCount,
    scheduled: scheduledCount,
  });
}

export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    let orgId: string | undefined;
    try {
      const task = StrategyTask.parse(JSON.parse(record.body));
      orgId = task.org_id;
      logger.appendKeys({ org_id: orgId });

      // Bail before the hard Lambda timeout so the catch can mark the org failed
      // instead of the process being killed mid-run (which strands the status).
      await withDeadline(context, () => runStrategy(orgId as string));
    } catch (err) {
      if (orgId) await OrgRepo.setStrategyStatus(orgId, 'failed').catch(() => {});
      logger.error('strategy failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id']);
    }
  }
};
