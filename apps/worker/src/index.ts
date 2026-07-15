import { OrgRepo } from '@shared/db';
import { domainRatingFromRank } from '@shared/providers';
import { ScanTask } from '@shared/schemas';
import type { SQSHandler } from 'aws-lambda';
import { logger } from './logger';
import { getScanClients } from './providers';
import { scanWebsite } from './scanner';

/**
 * Scanner worker — triggered by SQS (enqueued from POST /setup/start_scan).
 * Scans the site, persists presets, and advances the org to
 * `setup_scan_completed`. See design/product-flow.md §1.1 / §2.
 */
export const handler: SQSHandler = async (event, context): Promise<void> => {
  if (context?.awsRequestId) logger.addContext(context);

  for (const record of event.Records) {
    try {
      const { org_id, website_url } = ScanTask.parse(JSON.parse(record.body));
      logger.appendKeys({ org_id });
      logger.info('scanning website', { website_url });

      const clients = getScanClients();
      const presets = await scanWebsite(website_url, clients);
      await OrgRepo.completeScan(org_id, presets);

      // Domain Rating is best-effort (#12): a provider failure must never fail
      // the scan — the stale-refresh path on GET /dashboard/domain-rating
      // recovers later.
      try {
        const domain = new URL(website_url).hostname.replace(/^www\./, '');
        const { rank } = await clients.dataForSeo.backlinksSummary(domain);
        const rating = domainRatingFromRank(rank);
        if (rating !== null) await OrgRepo.updateDomainRating(org_id, rating);
        logger.info('domain rating stamped', { rating });
      } catch (drErr) {
        logger.warn('domain rating fetch failed', { error: drErr as Error });
      }

      logger.info('scan completed');
    } catch (err) {
      // Re-throw so SQS redelivers the message (and routes to the DLQ on
      // repeated failure); the log captures why before it's retried.
      logger.error('scan failed', { messageId: record.messageId, error: err as Error });
      throw err;
    } finally {
      logger.removeKeys(['org_id']);
    }
  }
};
