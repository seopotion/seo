import { addCandidates, CandidateRepo, KeywordRepo, OrgRepo, scheduleCandidate } from '@shared/db';
import { clusterSpreadSchedule, runKeywordPipeline } from '@shared/keywords';
import { type Candidate, normalizeKeyword, StrategyTask } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getStrategyClients } from './providers';

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

/**
 * Strategy worker — triggered by SQS (enqueued from POST /setup/finalize for
 * paid orgs). Runs the keyword pipeline, persists candidates, and schedules up
 * to 30 non-overlapping planner entries spread across 30 days. Idempotent:
 * skips if already completed; on failure marks the org and rethrows so SQS
 * redelivers (-> DLQ). See design/product-flow.md and epic #56.
 */
export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    let orgId: string | undefined;
    try {
      const task = StrategyTask.parse(JSON.parse(record.body));
      orgId = task.org_id;
      logger.appendKeys({ org_id: orgId });

      const org = await OrgRepo.findById(orgId);
      if (!org?.presets) {
        logger.warn('strategy skipped: org or presets missing');
        continue;
      }
      if (org.strategy_status === 'completed') {
        logger.info('strategy already completed; skipping');
        continue;
      }

      const clients = getStrategyClients();
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
      });

      const inserted = await addCandidates(orgId, result.candidates);
      const storedByNormalized = new Map(inserted.map((c) => [c.normalized_keyword, c]));

      // Select schedulable candidates: accepted (no rejection), real metrics,
      // not already on the planner. Rank by opportunity_score desc, stable.
      const scheduledSet = new Set(scheduled.map((k) => normalizeKeyword(k.keyword)));
      // Strategy entries this job wrote carry a non-null opportunity_score; manual #50
      // selections go to the candidate pool (not KeywordRepo), so this proxy counts
      // only prior strategy output. Budget the remaining 30-day plan against them and
      // offset the start date so a redelivered partial run neither exceeds PLAN_DAYS
      // nor collides calendar dates with already-created entries.
      const alreadyScheduled = scheduled.filter((k) => k.opportunity_score !== null).length;
      const budget = Math.max(0, PLAN_DAYS - alreadyScheduled);
      const selectable = result.candidates
        .filter(
          (c) =>
            c.rejection_reason === null &&
            c.search_volume !== null &&
            c.difficulty !== null &&
            !scheduledSet.has(normalizeKeyword(c.keyword)),
        )
        .sort(
          (a, b) =>
            (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0) ||
            normalizeKeyword(a.keyword).localeCompare(normalizeKeyword(b.keyword)),
        )
        .slice(0, budget);

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
      logger.info('strategy completed', { scheduled: scheduledCount });
    } catch (err) {
      if (orgId) await OrgRepo.setStrategyStatus(orgId, 'failed').catch(() => {});
      logger.error('strategy failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id']);
    }
  }
};
