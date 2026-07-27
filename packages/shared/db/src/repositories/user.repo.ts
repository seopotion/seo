import {
  type CreateUserInput,
  CreateUserInput as CreateUserInputSchema,
  type User,
  UserSchema,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('users');

function toEntity(doc: WithId<Document>): User {
  const { _id, ...rest } = doc;
  return UserSchema.parse({ id: _id.toString(), ...rest });
}

export const UserRepo = {
  async findById(id: string): Promise<User | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async findByGoogleSub(googleSub: string): Promise<User | null> {
    const doc = await (await collection()).findOne({ google_sub: googleSub });
    return doc ? toEntity(doc) : null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const doc = await (await collection()).findOne({ email });
    return doc ? toEntity(doc) : null;
  },

  /** Find-or-create by Google subject id. Used by the login flow. */
  async upsertByGoogleSub(input: CreateUserInput): Promise<User> {
    const data = CreateUserInputSchema.parse(input);
    const col = await collection();
    const existing = await col.findOne({ google_sub: data.google_sub });
    if (existing) return toEntity(existing);

    const created_at = new Date();
    const res = await col.insertOne({ ...data, created_at });
    return toEntity({ _id: res.insertedId, ...data, created_at });
  },

  /** Delete the user document (CLI delete-user). Org data is deleted separately. */
  async deleteById(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).deleteOne({ _id: new ObjectId(id) });
    return res.deletedCount === 1;
  },
};
