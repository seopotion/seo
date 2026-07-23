import {
  type Article,
  type ArticleImage,
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

  async setWordPressPostId(id: string, postId: number): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { wordpress_post_id: postId } },
    );
    return res.matchedCount > 0;
  },

  /** Save the editor's five editable fields, stamping `updated_at` (#74). */
  async updateContent(
    id: string,
    patch: Pick<Article, 'title' | 'slug' | 'meta_title' | 'meta_description' | 'content'>,
  ): Promise<Article | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...patch, updated_at: new Date() } },
      { returnDocument: 'after' },
    );
    return doc ? toEntity(doc) : null;
  },

  /** Persist the image plan once (set-if-absent) — a retry never re-plans (#51). */
  async setImagePlan(id: string, images: ArticleImage[]): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), 'images.0': { $exists: false } },
      { $set: { images, images_status: 'pending' } },
    );
    return res.modifiedCount === 1;
  },

  /**
   * Fill slot `index` — only while its url is '' (pending→generated guard, so a
   * redelivery can't double-fill or double-inject). `newContent` swaps the
   * article markdown atomically in the same update (null = leave content alone).
   */
  async fillImageSlot(
    id: string,
    index: number,
    fill: { url: string; model: string; seed: number | null; generated_at: Date },
    newContent: string | null,
  ): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const set: Document = {
      [`images.${index}.url`]: fill.url,
      [`images.${index}.model`]: fill.model,
      [`images.${index}.seed`]: fill.seed,
      [`images.${index}.generated_at`]: fill.generated_at,
    };
    if (newContent !== null) set.content = newContent;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(id), [`images.${index}.url`]: '' },
      { $set: set },
    );
    return res.modifiedCount === 1;
  },

  /** Mark images complete + set the cover as featured — only when every slot is filled (#51). */
  async completeImages(id: string, coverUrl: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        images_status: { $ne: 'complete' },
        'images.0': { $exists: true },
        images: { $not: { $elemMatch: { url: '' } } },
      },
      { $set: { images_status: 'complete', featured_image_url: coverUrl } },
    );
    return res.modifiedCount === 1;
  },

  /** Record an image-plan failure. Never downgrades a completed article (#51). */
  async failImages(id: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id), images_status: { $ne: 'complete' } },
      { $set: { images_status: 'failed' } },
    );
  },

  /** Delete every article for an org (used by the `db reset-user` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
};
