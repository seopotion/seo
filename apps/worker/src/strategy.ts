import { addCandidates, CandidateRepo, KeywordRepo, OrgRepo, scheduleCandidate } from '@shared/db';
import { clusterSpreadSchedule, runKeywordPipeline } from '@shared/keywords';
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

/**
 * Strategy worker — triggered by SQS (enqueued from POST /setup/finalize for
 * paid orgs). Runs the keyword pipeline, persists candidates, and schedules up
 * to 30 non-overlapping planner entries spread across 30 days. Idempotent:
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
  const articleKeywords: string[] = []; // ArticleRepo has none until #55 generates

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
  // flattens the plan's spread but never schedules the wrong keyword (#211).
  logger.info('strategy pipeline stats', { ...result.stats });

  const inserted = await addCandidates(orgId, result.candidates);
  const storedByNormalized = new Map(inserted.map((c) => [c.normalized_keyword, c]));

  // Select schedulable candidates: SERP-validated, real metrics, not already on
  // the planner. Rank by opportunity_score desc, stable. `rejection_reason ===
  // null` is NOT sufficient — it is also true of every below-serpTopN candidate,
  // which was scored but never validated or classified (#211).
  const scheduledSet = new Set(scheduled.map((k) => normalizeKeyword(k.keyword)));
  // Strategy entries this job wrote carry a non-null opportunity_score; manual #50
  // selections go to the candidate pool (not KeywordRepo), so this proxy counts
  // only prior strategy output. Budget the remaining 30-day plan against them and
  // offset the start date so a redelivered partial run neither exceeds PLAN_DAYS
  // nor collides calendar dates with already-created entries.
  const alreadyScheduled = scheduled.filter((k) => k.opportunity_score !== null).length;
  const budget = Math.max(0, PLAN_DAYS - alreadyScheduled);
  const qualified = result.candidates
    .filter(
      (c) =>
        c.serp_validated &&
        c.rejection_reason === null &&
        c.search_volume !== null &&
        c.difficulty !== null &&
        !scheduledSet.has(normalizeKeyword(c.keyword)),
    )
    .sort(
      (a, b) =>
        (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0) ||
        normalizeKeyword(a.keyword).localeCompare(normalizeKeyword(b.keyword)),
    );
  const selectable = qualified.slice(0, budget);

  // A short plan is the correct outcome when the pipeline validated fewer than
  // `budget` keywords — padding it from the unvalidated tier is what put junk on
  // the planner (#211). Log the shortfall so an under-filled plan is visible.
  if (qualified.length < budget) {
    logger.warn('strategy plan under-filled', {
      requested: budget,
      qualified: qualified.length,
      shortfall: budget - qualified.length,
    });
  }

  const startDay = new Date();
  startDay.setUTCDate(startDay.getUTCDate() + alreadyScheduled);
  const plan = clusterSpreadSchedule(selectable, startDay, budget);

  // Schedule via the shared service (#99) so strategy honors the same
  // invariants as manual scheduling: candidate_id linkage, unique
  // org/date + org/keyword indexes, claim-then-insert idempotency. Dates
  // already taken (e.g. by manual entries) are skipped to the next free
  // day; per-entry conflicts never fail the whole job.
  const occupied = new Set(scheduled.map((k) => k.scheduled_date));
  let scheduledCount = 0;
  for (const c of plan) {
    const normalized = normalizeKeyword(c.keyword);
    const stored: Candidate | null =
      storedByNormalized.get(normalized) ??
      (await CandidateRepo.findByNormalized(orgId, normalized));
    if (!stored) continue;

    let date = nextFreeDate(c.scheduled_date, occupied);
    let res = await scheduleCandidate(stored, date);
    if (!res.ok && res.reason === 'date_occupied') {
      // Lost a race for the date: mark it taken and try the next free one.
      occupied.add(date);
      date = nextFreeDate(date, occupied);
      res = await scheduleCandidate(stored, date);
    }
    if (res.ok) {
      occupied.add(res.keyword.scheduled_date);
      scheduledCount++;
    } else {
      logger.info('strategy schedule skipped', { keyword: c.keyword, reason: res.reason });
    }
  }

  await OrgRepo.setStrategyStatus(orgId, 'completed');
  logger.info('strategy completed', {
    requested: budget,
    qualified: qualified.length,
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
