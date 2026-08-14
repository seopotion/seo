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

/**
 * Image task message — the contract on the SQS images queue between the
 * generation worker (producer, apps/worker/src/generation.ts) and the images
 * worker (consumer, apps/worker/src/images.ts). See #51.
 */
export const ImageTask = z.object({
  org_id: z.string(),
  article_id: z.string(),
});
export type ImageTask = z.infer<typeof ImageTask>;

export const PublishTask = z.object({
  org_id: z.string(),
  article_id: z.string(),
  provider: z.enum(INTEGRATION_PROVIDERS),
});
export type PublishTask = z.infer<typeof PublishTask>;
