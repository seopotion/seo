import { addCandidates, CandidateRepo, KeywordRepo, OrgRepo } from '@shared/db';
import { clusterSpreadSchedule, runKeywordPipeline } from '@shared/keywords';
import { normalizeKeyword, StrategyTask } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getStrategyClients } from './providers';

const PLAN_DAYS = 30;

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

      await addCandidates(orgId, result.candidates);

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
      for (const c of plan) {
        await KeywordRepo.create({
          org_id: orgId,
          keyword: c.keyword,
          status: 'scheduled',
          scheduled_date: c.scheduled_date,
          search_volume: c.search_volume as number,
          difficulty: c.difficulty as number,
          article_id: null,
          article_type: c.article_type,
          intent: c.intent,
          opportunity_score: c.opportunity_score,
          serp_competitors: c.serp_competitors,
        });
        const stored = await CandidateRepo.findByNormalized(orgId, normalizeKeyword(c.keyword));
        if (stored) await CandidateRepo.setStatus(stored.id, 'selected');
      }

      await OrgRepo.setStrategyStatus(orgId, 'completed');
      logger.info('strategy completed', { scheduled: plan.length });
    } catch (err) {
      if (orgId) await OrgRepo.setStrategyStatus(orgId, 'failed').catch(() => {});
      logger.error('strategy failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id']);
    }
  }
};
