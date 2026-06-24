import {
  type CreateOrgInput,
  CreateOrgInput as CreateOrgInputSchema,
  type Org,
  OrgSchema,
  type SetupPresets,
  SetupPresetsSchema,
} from '@shared/schemas';
import type { SetupStatus } from '@shared/types';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('orgs');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Org {
  const { _id, ...rest } = doc;
  return OrgSchema.parse({ id: _id.toString(), ...rest });
}

export const OrgRepo = {
  async findById(id: string): Promise<Org | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async findByUserId(userId: string): Promise<Org[]> {
    const docs = await (await collection()).find({ user_id: userId }).toArray();
    return docs.map(toEntity);
  },

  async create(input: CreateOrgInput): Promise<Org> {
    const data = CreateOrgInputSchema.parse(input); // validate on write
    const created_at = new Date();
    const res = await (await collection()).insertOne({ ...data, created_at });
    return toEntity({ _id: res.insertedId, ...data, created_at });
  },

  async updateStatus(id: string, setup_status: SetupStatus): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne({ _id: new ObjectId(id) }, { $set: { setup_status } });
  },

  /** Store the scan presets and mark scanning complete (single update). */
  async completeScan(id: string, presets: SetupPresets): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const data = SetupPresetsSchema.parse(presets); // validate on write
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { presets: data, setup_status: 'setup_scan_completed' } },
    );
  },
};
