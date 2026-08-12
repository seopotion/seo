import {
  type Candidate,
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
    const normalized_keyword = normalizeKeyword(data.keyword);
    const res = await (await collection()).insertOne({ ...data, normalized_keyword, created_at });
    return toEntity({ _id: res.insertedId, ...data, normalized_keyword, created_at });
  },

  async findByOrgAndDate(orgId: string, date: string): Promise<Keyword | null> {
    const doc = await (await collection()).findOne({ org_id: orgId, scheduled_date: date });
    return doc ? toEntity(doc) : null;
  },

  async findByCandidateId(orgId: string, candidateId: string): Promise<Keyword | null> {
    const doc = await (await collection()).findOne({ org_id: orgId, candidate_id: candidateId });
    return doc ? toEntity(doc) : null;
  },

  /**
   * Create a planner entry from a candidate (#99), copying its metrics and
   * classification. Unique-index violations (occupied date / duplicate
   * keyword / already-scheduled candidate) propagate for the scheduling
   * service to map into typed conflicts.
   */
  async createFromCandidate(candidate: Candidate, scheduledDate: string): Promise<Keyword> {
    if (candidate.search_volume === null || candidate.difficulty === null) {
      throw new Error(`candidate ${candidate.id} is missing metrics required by KeywordSchema`);
    }
    return KeywordRepo.create({
      org_id: candidate.org_id,
      candidate_id: candidate.id,
      keyword: candidate.keyword,
      status: 'scheduled',
      scheduled_date: scheduledDate,
      search_volume: candidate.search_volume,
      difficulty: candidate.difficulty,
      article_id: null,
      article_type: candidate.article_type,
      intent: candidate.intent,
      opportunity_score: candidate.opportunity_score,
      serp_competitors: candidate.serp_competitors,
      topic_cluster_id: candidate.topic_cluster_id,
      topic_cluster_label: candidate.topic_cluster_label,
      topic_role: candidate.topic_role,
      topic_content_focus: candidate.topic_content_focus,
      topic_primary_keyword: candidate.topic_primary_keyword,
    });
  },

  /**
   * Move an ungenerated planner entry to a new date (#99). Conditional on
   * `pending` + unlinked so an in-flight/finished generation never moves; a
   * unique-index violation on the destination date propagates to the caller.
   */
  async reschedulePending(keywordId: string, scheduledDate: string): Promise<Keyword | null> {
    if (!ObjectId.isValid(keywordId)) return null;
    const doc = await (await collection()).findOneAndUpdate(
      { _id: new ObjectId(keywordId), article_id: null, generation_status: 'pending' },
      { $set: { scheduled_date: scheduledDate } },
      { returnDocument: 'after' },
    );
    return doc ? toEntity(doc) : null;
  },

  /**
   * Delete a planner entry only while generation has not produced or started
   * anything (#99): unlinked and `pending`/`failed`. Returns the deleted
   * keyword so the caller can release its candidate.
   */
  async deleteUnstarted(keywordId: string): Promise<Keyword | null> {
    if (!ObjectId.isValid(keywordId)) return null;
    const doc = await (await collection()).findOneAndDelete({
      _id: new ObjectId(keywordId),
      article_id: null,
      generation_status: { $in: ['pending', 'failed'] },
    });
    return doc ? toEntity(doc) : null;
  },

  /** Link a generated article back to its keyword (article_id null -> set). */
  async setArticleId(id: string, articleId: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { article_id: articleId } },
    );
  },

  async findById(id: string): Promise<Keyword | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  /**
   * Atomically claim a keyword for generation. Succeeds only when it is
   * unlinked and not already terminal/in-flight (a 'generating' claim older
   * than 15min is treated as stale and reclaimable). Mirrors OrgRepo.claimStrategy.
   */
  async claimGeneration(id: string): Promise<boolean> {
    if (!ObjectId.isValid(id)) return false;
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    const res = await (await collection()).updateOne(
      {
        _id: new ObjectId(id),
        article_id: null,
        $or: [
          { generation_status: { $in: ['pending', 'failed'] } },
          { generation_status: { $exists: false } },
          { generation_status: 'generating', generation_started_at: { $lt: staleBefore } },
        ],
      },
      {
        $set: { generation_status: 'generating', generation_started_at: new Date() },
        $inc: { generation_attempts: 1 },
      },
    );
    return res.modifiedCount === 1;
  },

  /**
   * Reset a failed, unlinked keyword to a fresh `pending` with zero attempts
   * (admin unstick lever, epic #150). This is the only recovery for keywords
   * past MAX_GENERATION_ATTEMPTS — `listDueForGeneration` excludes them
   * forever otherwise. Conditional: in-flight/terminal entries never reset.
   */
  async resetGeneration(keywordId: string): Promise<boolean> {
    if (!ObjectId.isValid(keywordId)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(keywordId), article_id: null, generation_status: 'failed' },
      { $set: { generation_status: 'pending', generation_attempts: 0, generation_error: null } },
    );
    return res.modifiedCount === 1;
  },

  /**
   * Edit the planner brief fields (admin lever, epic #150). Conditional on
   * `pending` + unlinked — the brief feeds generation, so an in-flight or
   * generated entry never changes under the worker.
   */
  async updateBrief(
    keywordId: string,
    fields: {
      article_type?: Keyword['article_type'];
      intent?: Keyword['intent'];
      opportunity_score?: number | null;
    },
  ): Promise<Keyword | null> {
    if (!ObjectId.isValid(keywordId)) return null;
    const set: Record<string, unknown> = {};
    if (fields.article_type !== undefined) set.article_type = fields.article_type;
    if (fields.intent !== undefined) set.intent = fields.intent;
    if (fields.opportunity_score !== undefined) set.opportunity_score = fields.opportunity_score;
    const doc = await (await collection()).findOneAndUpdate(
      { _id: new ObjectId(keywordId), article_id: null, generation_status: 'pending' },
      { $set: set },
      { returnDocument: 'after' },
    );
    return doc ? toEntity(doc) : null;
  },

  /** Record a generation failure (retryable until the attempt cap / DLQ). */
  async failGeneration(id: string, error: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { generation_status: 'failed', generation_error: error } },
    );
  },

  /** Atomically link the generated article and mark the keyword done. */
  async linkArticle(id: string, articleId: string): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { article_id: articleId, generation_status: 'generated', generation_error: null } },
    );
  },

  /**
   * Due entries across all orgs for the daily scheduler: scheduled on/before
   * `today` (yyyy-mm-dd), not yet linked, not generated, under the attempt cap.
   */
  async listDueForGeneration(today: string, maxAttempts: number): Promise<Keyword[]> {
    const docs = await (await collection())
      .find({
        scheduled_date: { $lte: today },
        article_id: null,
        generation_status: { $ne: 'generated' },
        $or: [
          { generation_attempts: { $lt: maxAttempts } },
          { generation_attempts: { $exists: false } },
        ],
      })
      .toArray();
    return docs.map(toEntity);
  },

  /** Normalized set of every keyword already on this org's planner. */
  async scheduledNormalizedSet(orgId: string): Promise<Set<string>> {
    const docs = await (await collection())
      .find({ org_id: orgId }, { projection: { keyword: 1 } })
      .toArray();
    return new Set(docs.map((d) => normalizeKeyword(d.keyword as string)));
  },

  /** Delete every keyword for an org (used by the `db reset-user` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
};
