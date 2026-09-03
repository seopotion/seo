import { OrgRepo } from '@shared/db';
import { domainRatingFromRank } from '@shared/providers';
import { ScanTask } from '@shared/schemas';
import type { SQSHandler, SQSRecord } from 'aws-lambda';
import { logger } from './logger';
import { getScanClients } from './providers';
import { scanWebsite } from './scanner';

/**
 * Deliveries a scan message gets before SQS dead-letters it — must match the
 * scan queue's `maxReceiveCount` in infra (passed through as env). The org is
 * only stamped `setup_scan_failed` on the last one, so a transient failure
 * that redelivery recovers from never flickers an error at the user (#244).
 */
const maxReceiveCount = Number(process.env.SCAN_MAX_RECEIVE_COUNT) || 3;

function isFinalDelivery(record: SQSRecord): boolean {
  const count = Number(record.attributes?.ApproximateReceiveCount);
  // Unknown count (local poller without attributes): fail fast rather than never.
  return !Number.isFinite(count) || count >= maxReceiveCount;
}

/** Best-effort org id for the failure stamp, even when the body fails ScanTask.parse. */
function orgIdOf(record: SQSRecord): string | null {
  try {
    const id = (JSON.parse(record.body) as { org_id?: unknown }).org_id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

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

      const clients = await getScanClients();
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
      // Last delivery: leave a terminal state behind instead of an org that
      // polls as in-progress forever (#244). Best-effort — the rethrow below
      // is what matters for SQS.
      const org_id = isFinalDelivery(record) ? orgIdOf(record) : null;
      if (org_id) {
        await OrgRepo.updateStatus(org_id, 'setup_scan_failed').catch((stampErr) => {
          logger.warn('could not stamp setup_scan_failed', { error: stampErr as Error });
        });
      }
      throw err;
    } finally {
      logger.removeKeys(['org_id']);
    }
  }
};
