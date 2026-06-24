import { SETUP_STATUSES } from '@shared/types';
import { z } from 'zod';

/**
 * Organization entity — the shape app code and the API work with.
 * `id` is a string (the stringified Mongo `_id`); the raw `_id` never
 * leaves the repository layer. See design/data-layer.md.
 */
export const OrgSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  website_url: z.string().url(),
  setup_status: z.enum(SETUP_STATUSES),
  name: z.string().optional(),
  created_at: z.date(),
});
export type Org = z.infer<typeof OrgSchema>;

/** Input for creating an org — the server assigns `id` and `created_at`. */
export const CreateOrgInput = OrgSchema.omit({ id: true, created_at: true });
export type CreateOrgInput = z.infer<typeof CreateOrgInput>;
