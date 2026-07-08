import {
  type CreateKeywordInput,
  CreateKeywordInput as CreateKeywordInputSchema,
  type Keyword,
  KeywordSchema,
  normalizeKeyword,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('keywords');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Keyword {
  const { _id, ...rest } = doc;
  return KeywordSchema.parse({ id: _id.toString(), ...rest });
}

export const KeywordRepo = {
  async listByOrg(orgId: string): Promise<Keyword[]> {
    const docs = await (await collection())
      .find({ org_id: orgId })
      .sort({ scheduled_date: 1 })
      .toArray();
    return docs.map(toEntity);
  },

  async countScheduled(orgId: string): Promise<number> {
    return (await collection()).countDocuments({ org_id: orgId, status: 'scheduled' });
  },

  async create(input: CreateKeywordInput): Promise<Keyword> {
    const data = CreateKeywordInputSchema.parse(input); // validate on write
    const created_at = new Date();
    const res = await (await collection()).insertOne({ ...data, created_at });
    return toEntity({ _id: res.insertedId, ...data, created_at });
  },

  /** Link a generated article back to its keyword (article_id null -> set). */
  async setArticleId(id: string, articleId: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { article_id: articleId } },
    );
  },

  /** Normalized set of every keyword already on this org's planner. */
  async scheduledNormalizedSet(orgId: string): Promise<Set<string>> {
    const docs = await (await collection())
      .find({ org_id: orgId }, { projection: { keyword: 1 } })
      .toArray();
    return new Set(docs.map((d) => normalizeKeyword(d.keyword as string)));
  },
};
