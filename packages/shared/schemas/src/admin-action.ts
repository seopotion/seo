import { z } from 'zod';

/**
 * One operator action against a customer org, recorded by the admin API after
 * every successful mutation (epic #150). The collection is append-only by
 * construction: `AdminActionRepo` exposes insert + list only.
 */
export const AdminActionSchema = z.object({
  id: z.string(),
  at: z.date(),
  /** Operator email (from the admin JWT). */
  actor: z.string(),
  /** Action name, e.g. 'org.set_plan' — see AdminActionName in apps/api. */
  action: z.string(),
  org_id: z.string(),
  entity: z.object({ type: z.string(), id: z.string() }).nullable(),
  /** Request body as received. */
  payload: z.unknown(),
  /** Pre-mutation entity snapshot — the manual-revert / "what changed" record. */
  before: z.unknown().nullable(),
});
export type AdminAction = z.infer<typeof AdminActionSchema>;

/** Input for recording an action — the server assigns `id` and stamps `at`. */
export const CreateAdminActionInput = AdminActionSchema.omit({ id: true, at: true });
export type CreateAdminActionInput = z.input<typeof CreateAdminActionInput>;
