import {
  CreatePromoCodeInput,
  type CreatePromoCodeInput as CreatePromoCodeInputType,
  type PromoCode,
  PromoCodeSchema,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('promo_codes');

function toEntity(doc: WithId<Document>): PromoCode {
  const { _id, ...rest } = doc;
  const data = { id: _id.toString(), ...rest } as Record<string, unknown>;
  // Convert null to undefined for optional fields
  if (data.duration_in_months === null) {
    delete data.duration_in_months;
  }
  if (data.expires_at === null) {
    delete data.expires_at;
  }
  if (data.max_redemptions === null) {
    delete data.max_redemptions;
  }
  if (data.affiliate === null) {
    delete data.affiliate;
  }
  return PromoCodeSchema.parse(data);
}

export const PromoCodeRepo = {
  /** Insert a new code. The unique `code` index rejects duplicates (E11000). */
  async create(input: CreatePromoCodeInputType): Promise<PromoCode> {
    const doc = { ...CreatePromoCodeInput.parse(input), created_at: new Date() };
    const res = await (await collection()).insertOne(doc);
    return toEntity({ _id: res.insertedId, ...doc });
  },

  /** Exact-match lookup — callers normalize user input to uppercase first. */
  async findByCode(code: string): Promise<PromoCode | null> {
    const doc = await (await collection()).findOne({ code });
    return doc ? toEntity(doc) : null;
  },

  async findById(id: string): Promise<PromoCode | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async list(): Promise<PromoCode[]> {
    const docs = await (await collection()).find({}).sort({ created_at: -1 }).toArray();
    return docs.map(toEntity);
  },

  /** One-way in v1 — the caller deletes the LS discount first (design §2). */
  async deactivate(id: string): Promise<PromoCode | null> {
    if (!ObjectId.isValid(id)) return null;
    const res = await (await collection()).findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { active: false } },
      { returnDocument: 'after' },
    );
    return res ? toEntity(res) : null;
  },
};
