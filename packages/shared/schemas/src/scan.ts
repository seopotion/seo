import { z } from 'zod';

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
