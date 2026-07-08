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

/**
 * Strategy task message — the contract on the SQS strategy queue between the API
 * (producer, POST /setup/finalize for paid orgs) and the strategy worker.
 */
export const StrategyTask = z.object({
  org_id: z.string(),
});
export type StrategyTask = z.infer<typeof StrategyTask>;

/**
 * Generate task message — the contract on the SQS generation queue between the
 * scheduler (producer, apps/worker/src/generation-scheduler.ts) and the
 * generation worker (consumer, apps/worker/src/generation.ts). See #55.
 */
export const GenerateTask = z.object({
  org_id: z.string(),
  keyword_id: z.string(),
});
export type GenerateTask = z.infer<typeof GenerateTask>;
