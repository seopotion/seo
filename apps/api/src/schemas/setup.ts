import { z } from '@hono/zod-openapi';
import {
  ContentSeoPatchSchema,
  EngagementPrefsPatchSchema,
  ONBOARDING_INTEGRATIONS,
  PublishingPrefsSchema,
  SetupPresetsSchema,
} from '@shared/schemas';
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

// Deep-partial of the presets shape: each category is optional, and within a
// category each field is optional. The nested objects under `article_preferences`
// are partialed too, so a client can patch a single deep field.
export const SetupPresetsPatchSchema = z
  .object({
    business: SetupPresetsSchema.shape.business.partial().optional(),
    audience: SetupPresetsSchema.shape.audience.partial().optional(),
    blog: SetupPresetsSchema.shape.blog.partial().optional(),
    article_preferences: z
      .object({
        content_seo: ContentSeoPatchSchema.optional(),
        engagement: EngagementPrefsPatchSchema.optional(),
        publishing: PublishingPrefsSchema.partial().optional(),
      })
      .optional(),
  })
  .openapi('SetupPresetsPatch');

export const UpdatePresetsBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    presets: SetupPresetsPatchSchema,
  })
  .openapi('UpdatePresetsBody');

export const FinalizeBody = z
  .object({
    org_id: z.string().openapi({ example: '6650f1a2b3c4d5e6f7a8b9c0' }),
    presets: SetupPresetsPatchSchema.optional(),
    referral_source: z.string().optional(),
    integrations: z.array(z.enum(ONBOARDING_INTEGRATIONS)).optional(),
  })
  .openapi('FinalizeBody');

export const PresetsResponse = z
  .object({
    presets: SetupPresetsSchema,
  })
  .openapi('PresetsResponse');

export const FinalizeResponse = z
  .object({
    setup_status: z.literal('setup_complete').openapi({ example: 'setup_complete' }),
    presets: SetupPresetsSchema,
  })
  .openapi('FinalizeResponse');

export const ConflictResponse = z
  .object({
    error: z.string().openapi({ example: 'Setup is not ready to finalize' }),
  })
  .openapi('ConflictResponse');
