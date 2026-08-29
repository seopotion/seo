import {
  type ArticleRun,
  ArticleRunSchema,
  type ArticleRunWorking,
  type ArticleStageName,
  type CreateArticleRunInput,
  CreateArticleRunInput as CreateArticleRunInputSchema,
  type StageState,
} from '@shared/schemas';
import { ObjectId } from 'mongodb';
import { getDb } from '../client';

const COLLECTION = 'article_runs';

type ArticleRunDoc = Omit<ArticleRun, 'id'> & { _id: ObjectId };

function toRun(doc: ArticleRunDoc): ArticleRun {
  const { _id, ...rest } = doc;
  return ArticleRunSchema.parse({ ...rest, id: _id.toHexString() });
}

/** `working` patch -> dot-path $set so untouched working fields survive. */
function workingSet(working: Partial<ArticleRunWorking>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(working).map(([key, value]) => [`working.${key}`, value]),
  );
}

export const ArticleRunRepo = {
  async create(input: CreateArticleRunInput): Promise<ArticleRun> {
    const db = await getDb();
    const now = new Date();
    const data = CreateArticleRunInputSchema.parse(input);
    const { insertedId } = await db
      .collection<Omit<ArticleRunDoc, '_id'>>(COLLECTION)
      .insertOne({ ...data, created_at: now, updated_at: now });
    return toRun({ ...data, created_at: now, updated_at: now, _id: insertedId });
  },

  async findById(id: string): Promise<ArticleRun | null> {
    if (!ObjectId.isValid(id)) return null;
    const db = await getDb();
    const doc = await db.collection<ArticleRunDoc>(COLLECTION).findOne({ _id: new ObjectId(id) });
    return doc ? toRun(doc) : null;
  },

  async saveStageResult(
    id: string,
    stage: ArticleStageName,
    working: Partial<ArticleRunWorking>,
    meta: StageState,
  ): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db.collection<ArticleRunDoc>(COLLECTION).updateOne(
      // Fenced (same rationale as StrategyRunRepo.saveStageResult): once a
      // stage is completed, a zombie Lambda's late write is rejected.
      { _id: new ObjectId(id), [`stages.${stage}.status`]: { $ne: 'completed' } },
      { $set: { ...workingSet(working), [`stages.${stage}`]: meta, updated_at: new Date() } },
    );
  },

  async patchWorking(id: string, working: Partial<ArticleRunWorking>): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db
      .collection<ArticleRunDoc>(COLLECTION)
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { ...workingSet(working), updated_at: new Date() } },
      );
  },

  async markStageFailed(id: string, stage: ArticleStageName, meta: StageState): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db
      .collection<ArticleRunDoc>(COLLECTION)
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { [`stages.${stage}`]: meta, updated_at: new Date() } },
      );
  },

  async setStatus(id: string, status: ArticleRun['status']): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db
      .collection<ArticleRunDoc>(COLLECTION)
      .updateOne({ _id: new ObjectId(id) }, { $set: { status, updated_at: new Date() } });
  },

  /** Every run for the org (used by the `db delete-org` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const db = await getDb();
    const res = await db.collection<ArticleRunDoc>(COLLECTION).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
};
