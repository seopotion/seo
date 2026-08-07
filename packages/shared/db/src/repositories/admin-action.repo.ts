import {
  type AdminAction,
  AdminActionSchema,
  type CreateAdminActionInput,
  CreateAdminActionInput as CreateAdminActionInputSchema,
} from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('admin_actions');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): AdminAction {
  const { _id, ...rest } = doc;
  return AdminActionSchema.parse({ id: _id.toString(), ...rest });
}

/**
 * Append-only audit log of operator actions (epic #150). By construction this
 * repo exposes insert + list ONLY — never add update or delete methods.
 */
export const AdminActionRepo = {
  async insert(input: CreateAdminActionInput): Promise<AdminAction> {
    const data = CreateAdminActionInputSchema.parse(input); // validate on write
    const at = new Date();
    const res = await (await collection()).insertOne({ ...data, at });
    return toEntity({ _id: res.insertedId, ...data, at });
  },

  /** The org's actions, newest first, paginated. */
  async listByOrg(
    orgId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ actions: AdminAction[]; total: number }> {
    const col = await collection();
    const [docs, total] = await Promise.all([
      col.find({ org_id: orgId }).sort({ at: -1 }).skip(opts.offset).limit(opts.limit).toArray(),
      col.countDocuments({ org_id: orgId }),
    ]);
    return { actions: docs.map(toEntity), total };
  },
};
