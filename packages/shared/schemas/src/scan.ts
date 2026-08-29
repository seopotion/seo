import { z } from 'zod';
import { INTEGRATION_PROVIDERS } from './integration';

/**
 * Scan task message — the contract on the SQS queue between the API (producer,
 * POST /setup/start_scan) and the scanner worker (consumer). Shared so the two
 * sides can't drift; the worker validates on read with `ScanTask.parse`.
 */
export const ScanTask = z.object({
  org_id: z.string(),
  website_url: z.string().url(),
});
export type ScanTask = z.infer<typeof ScanTask>;

export const PublishTask = z.object({
  org_id: z.string(),
  article_id: z.string(),
  provider: z.enum(INTEGRATION_PROVIDERS),
});
export type PublishTask = z.infer<typeof PublishTask>;
