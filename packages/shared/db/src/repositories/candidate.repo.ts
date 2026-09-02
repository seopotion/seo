import {
  type Candidate,
  CandidateSchema,
  type CreateCandidateInput,
  CreateCandidateInput as CreateCandidateInputSchema,
  normalizeKeyword,
} from '@shared/schemas';
import {
  type Document,
  MongoBulkWriteError,
  MongoServerError,
  ObjectId,
  type WithId,
} from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('candidates');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): Candidate {
  const { _id, ...rest } = doc;
  return CandidateSchema.parse({ id: _id.toString(), ...rest });
}

export const CandidateRepo = {
  /**
   * Insert candidates for an org, deriving `normalized_keyword` and deduping
   * both within the batch and against already-stored candidates. Returns only
   * the newly inserted candidates.
   */
  async insertMany(
    orgId: string,
    items: CreateCandidateInput[],
    opts: { excludeNormalized?: Set<string> } = {},
  ): Promise<Candidate[]> {
    if (items.length === 0) return [];

    // Validate + derive normalized key.
    const prepared = items.map((item) => {
      const data = CreateCandidateInputSchema.parse({ ...item, org_id: orgId });
      return { ...data, normalized_keyword: normalizeKeyword(data.keyword) };
    });

    // Dedupe within the batch (keep first occurrence) and against excluded keywords.
    const seen = new Set<string>();
    const exclude = opts.excludeNormalized ?? new Set<string>();
    const batch = prepared.filter(
      (p) =>
        !exclude.has(p.normalized_keyword) &&
        !seen.has(p.normalized_keyword) &&
        seen.add(p.normalized_keyword),
    );

    const col = await collection();
    const existing = await col
      .find(
        { org_id: orgId, normalized_keyword: { $in: batch.map((b) => b.normalized_keyword) } },
        { projection: { normalized_keyword: 1 } },
      )
      .toArray();
    const existingSet = new Set(existing.map((e) => e.normalized_keyword as string));

    const toInsert = batch.filter((b) => !existingSet.has(b.normalized_keyword));
    if (toInsert.length === 0) return [];

    const now = new Date();
    const docs = toInsert.map((d) => ({ ...d, created_at: now, updated_at: now }));
    const res = await col.insertMany(docs, { ordered: false });
    return docs.map((d, i) => toEntity({ _id: res.insertedIds[i]!, ...d }));
  },

  async persistStrategyMany(orgId: string, items: CreateCandidateInput[]): Promise<Candidate[]> {
    if (items.length === 0) return [];

    const now = new Date();
    const prepared = items.map((item) => {
      const data = CreateCandidateInputSchema.parse({ ...item, org_id: orgId });
      return {
        data,
        normalized_keyword: normalizeKeyword(data.keyword),
        strategyFields: {
          core_keyword: data.core_keyword,
          category_ids: data.category_ids,
          search_volume: data.search_volume,
          difficulty: data.difficulty,
          cpc: data.cpc,
          competition: data.competition,
          trend: data.trend,
          intent: data.intent,
          relevance_score: data.relevance_score,
          opportunity_score: data.opportunity_score,
          article_type: data.article_type,
          serp_competitors: data.serp_competitors,
          serp_validated: data.serp_validated,
          topic_cluster_id: data.topic_cluster_id,
          topic_cluster_label: data.topic_cluster_label,
          topic_role: data.topic_role,
          topic_content_focus: data.topic_content_focus,
          topic_primary_keyword: data.topic_primary_keyword,
          updated_at: now,
        },
      };
    });

    const col = await collection();
    try {
      await col.bulkWrite(
        prepared.map(({ data, normalized_keyword, strategyFields }) => ({
          updateOne: {
            filter: { org_id: orgId, normalized_keyword },
            update: {
              $set: strategyFields,
              $setOnInsert: {
                org_id: orgId,
                normalized_keyword,
                keyword: data.keyword,
                source: data.source,
                source_context: data.source_context,
                status: data.status,
                rejection_reason: data.rejection_reason,
                created_at: now,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false },
      );
    } catch (error) {
      const bulkWriteErrors =
        error instanceof MongoBulkWriteError
          ? Array.isArray(error.writeErrors)
            ? error.writeErrors
            : [error.writeErrors]
          : [];
      const duplicateRace =
        error instanceof MongoBulkWriteError
          ? bulkWriteErrors.length > 0 &&
            bulkWriteErrors.every((writeError) => writeError.code === 11000)
          : error instanceof MongoServerError && error.code === 11000;
      if (!duplicateRace) throw error;
      await col.bulkWrite(
        prepared.map(({ normalized_keyword, strategyFields }) => ({
          updateOne: {
            filter: { org_id: orgId, normalized_keyword },
            update: { $set: strategyFields },
          },
        })),
        { ordered: false },
      );
    }

    // Refresh the pipeline's verdict on rows it owns: still-open candidates and
    // rows an earlier run rejected (rejection_reason set). Operator decisions
    // survive a rerun — an admin reject has no rejection_reason, and a
    // scheduled row is `selected` — otherwise a forced rerun could never
    // schedule a keyword the first run rejected (#301).
    await col.bulkWrite(
      prepared.map(({ data, normalized_keyword }) => ({
        updateOne: {
          filter: {
            org_id: orgId,
            normalized_keyword,
            $or: [{ status: 'candidate' }, { status: 'rejected', rejection_reason: { $ne: null } }],
          },
          update: {
            $set: {
              status: data.status,
              rejection_reason: data.rejection_reason,
              updated_at: now,
            },
          },
        },
      })),
      { ordered: false },
    );

    const docs = await col
      .find({
        org_id: orgId,
        normalized_keyword: { $in: prepared.map((item) => item.normalized_keyword) },
      })
      .toArray();
    const byNormalized = new Map(
      docs.map((doc) => [doc.normalized_keyword as string, toEntity(doc)]),
    );
    return prepared.map(({ normalized_keyword }) => {
      const persisted = byNormalized.get(normalized_keyword);
      if (!persisted) {
        throw new Error(`strategy candidate persistence lost ${normalized_keyword}`);
      }
      return persisted;
    });
  },

  /**
   * Paginated candidate-pool read (#99). Stable ordering: opportunity_score
   * desc (nulls last), created_at asc, _id asc as deterministic tie-breaker.
   */
  async listByOrg(
    orgId: string,
    opts: { status?: Candidate['status']; limit?: number; offset?: number } = {},
  ): Promise<{ candidates: Candidate[]; total: number }> {
    const query: Document = { org_id: orgId };
    if (opts.status) query.status = opts.status;
    const col = await collection();
    const cursor = col
      .find(query)
      .sort({ opportunity_score: -1, created_at: 1, _id: 1 })
      .skip(opts.offset ?? 0);
    if (opts.limit !== undefined) cursor.limit(opts.limit);
    const [docs, total] = await Promise.all([cursor.toArray(), col.countDocuments(query)]);
    return { candidates: docs.map(toEntity), total };
  },

  async findById(id: string): Promise<Candidate | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await (await collection()).findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  },

  /**
   * Conditionally claim a candidate for scheduling: only a `candidate` may
   * become `selected`, so concurrent claims have exactly one winner (#99).
   */
  async claimForScheduling(candidateId: string): Promise<Candidate | null> {
    if (!ObjectId.isValid(candidateId)) return null;
    const doc = await (await collection()).findOneAndUpdate(
      { _id: new ObjectId(candidateId), status: 'candidate' },
      { $set: { status: 'selected', updated_at: new Date() } },
      { returnDocument: 'after' },
    );
    return doc ? toEntity(doc) : null;
  },

  /**
   * Conditionally reject a candidate: only a `candidate` may be rejected, so a
   * scheduled/`selected` or already-rejected one is refused and concurrent
   * rejections have exactly one winner.
   */
  async rejectIfCandidate(candidateId: string): Promise<boolean> {
    if (!ObjectId.isValid(candidateId)) return false;
    const doc = await (await collection()).findOneAndUpdate(
      { _id: new ObjectId(candidateId), status: 'candidate' },
      { $set: { status: 'rejected', updated_at: new Date() } },
      { returnDocument: 'after' },
    );
    return doc !== null;
  },

  /**
   * Conditionally un-reject a candidate (admin unstick lever, epic #150):
   * only a `rejected` one may return to the pool, so concurrent restores have
   * exactly one winner — same style as `rejectIfCandidate`. Supersedes the
   * dead unconditional `setStatus`; never expose that raw setter.
   */
  async restoreRejected(candidateId: string): Promise<boolean> {
    if (!ObjectId.isValid(candidateId)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(candidateId), status: 'rejected' },
      { $set: { status: 'candidate', updated_at: new Date() } },
    );
    return res.modifiedCount === 1;
  },

  /** Return a `selected` candidate to the pool after unscheduling (#99). */
  async releaseAfterUnschedule(candidateId: string): Promise<boolean> {
    if (!ObjectId.isValid(candidateId)) return false;
    const res = await (await collection()).updateOne(
      { _id: new ObjectId(candidateId), status: 'selected' },
      { $set: { status: 'candidate', updated_at: new Date() } },
    );
    return res.modifiedCount === 1;
  },

  async findByNormalized(orgId: string, normalized: string): Promise<Candidate | null> {
    const doc = await (await collection()).findOne({
      org_id: orgId,
      normalized_keyword: normalized,
    });
    return doc ? toEntity(doc) : null;
  },

  async setStatus(id: string, status: Candidate['status']): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    await (await collection()).updateOne(
      { _id: new ObjectId(id) },
      { $set: { status, updated_at: new Date() } },
    );
  },

  /** Delete every candidate for an org (used by the `db reset-user` CLI). */
  async deleteByOrgId(orgId: string): Promise<number> {
    const res = await (await collection()).deleteMany({ org_id: orgId });
    return res.deletedCount;
  },
};
