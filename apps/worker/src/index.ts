import { OrgRepo } from '@shared/db';
import { ScanTask } from '@shared/schemas';
import type { SQSEvent, SQSHandler } from 'aws-lambda';
import { scanWebsite } from './scanner';

/**
 * Scanner worker — triggered by SQS (enqueued from POST /setup/start_scan).
 * Scans the site, persists presets, and advances the org to
 * `setup_scan_completed`. See design/product-flow.md §1.1 / §2.
 */
export const handler: SQSHandler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    const { org_id, website_url } = ScanTask.parse(JSON.parse(record.body));

    await scanWebsite(website_url);
    // TODO: persist presets to the org (separate presets collection / fields).

    await OrgRepo.updateStatus(org_id, 'setup_scan_completed');
  }
};
