import {
  type Article,
  ArticleSchema,
  type CreateArticleInput,
  CreateArticleInput as CreateArticleInputSchema,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('articles');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Article {
  const { _id, ...rest } = doc;
  return ArticleSchema.parse({ id: _id.toString(), ...rest });
}

export const ArticleRepo = {
  async listByOrg(
    orgId: string,
    opts: { status?: Article['status']; limit: number; offset: number },
  ): Promise<{ articles: Article[]; total: number }> {
    const filter: Document = { org_id: orgId };
    if (opts.status) filter.status = opts.status;
    const col = await collection();
    const total = await col.countDocuments(filter);
    const docs = await col
      .find(filter)
      .sort({ created_at: -1 })
      .skip(opts.offset)
      .limit(opts.limit)
      .toArray();
    return { articles: docs.map(toEntity), total };
  },

  async findById(id: string): Promise<Article | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  async countByStatus(orgId: string, status: Article['status']): Promise<number> {
    return (await collection()).countDocuments({ org_id: orgId, status });
  },

  async create(input: CreateArticleInput): Promise<Article> {
    const data = CreateArticleInputSchema.parse(input); // validate on write
    const created_at = new Date();
    const res = await (await collection()).insertOne({ ...data, created_at });
    return toEntity({ _id: res.insertedId, ...data, created_at });
  },
};
