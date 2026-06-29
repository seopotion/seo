import { z } from '@hono/zod-openapi';
import { SetupPresetsSchema } from '@shared/schemas';
import { SETUP_STATUSES } from '@shared/types';

export const StartScanBody = z
  .object({
    website_url: z.string().url().openapi({ example: 'https://example.com' }),
  })
  .openapi('StartScanBody');

export const StartScanResponse = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    setup_status: z.enum(SETUP_STATUSES).openapi({ example: 'setup_scan_in_progress' }),
  })
  .openapi('StartScanResponse');

export const StatusQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const StatusResponse = z
  .object({
    setup_status: z.enum(SETUP_STATUSES).openapi({ example: 'setup_scan_completed' }),
  })
  .openapi('StatusResponse');

export const DetailsQuery = z.object({
  org_id: z
    .string()
    .openapi({ param: { name: 'org_id', in: 'query' }, example: '6650f1a2b3c4d5e6f7a8b9c0' }),
});

export const DetailsResponse = z
  .object({
    presets: SetupPresetsSchema,
  })
  .openapi('DetailsResponse');

export const NotFoundResponse = z
  .object({
    error: z.string().openapi({ example: 'Setup details not available' }),
  })
  .openapi('NotFoundResponse');
