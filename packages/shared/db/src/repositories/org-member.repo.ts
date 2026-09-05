import {
  type CreateOrgMemberInput,
  CreateOrgMemberInput as CreateOrgMemberInputSchema,
  type OrgMember,
  OrgMemberSchema,
} from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';
import { isDuplicateKeyError } from '../services/schedule-candidate';

const collection = async () => (await getDb()).collection('org_members');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): OrgMember {
  const { _id, ...rest } = doc;
  return OrgMemberSchema.parse({ id: _id.toString(), ...rest });
}

const normalize = (email: string) => email.trim().toLowerCase();

export const OrgMemberRepo = {
  /** Roster for an org, oldest first. */
  async listByOrgId(orgId: string): Promise<OrgMember[]> {
    const docs = await (await collection())
      .find({ org_id: orgId })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map(toEntity);
  },

  async findByOrgAndEmail(orgId: string, email: string): Promise<OrgMember | null> {
    const doc = await (await collection()).findOne({ org_id: orgId, email: normalize(email) });
    return doc ? toEntity(doc) : null;
  },

  /** Ids of every org this email was added to. */
  async listOrgIdsByEmail(email: string): Promise<string[]> {
    const docs = await (await collection())
      .find({ email: normalize(email) }, { projection: { org_id: 1 } })
      .toArray();
    return docs.map((d) => String(d.org_id));
  },

  /** Insert a member. Returns null when `(org_id, email)` already exists. */
  async add(input: CreateOrgMemberInput): Promise<OrgMember | null> {
    const data = CreateOrgMemberInputSchema.parse({ ...input, email: normalize(input.email) });
    const created_at = new Date();
    try {
      const res = await (await collection()).insertOne({ ...data, created_at });
      return toEntity({ _id: res.insertedId, ...data, created_at });
    } catch (e) {
      if (isDuplicateKeyError(e)) return null;
      throw e;
    }
  },

  /** Returns true when a row matched. */
  async remove(orgId: string, email: string): Promise<boolean> {
    const res = await (await collection()).deleteOne({ org_id: orgId, email: normalize(email) });
    return res.deletedCount === 1;
  },

  /** delete-org sweep. Returns the number of rows removed. */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
};
