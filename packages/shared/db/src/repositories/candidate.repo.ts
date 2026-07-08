import {
  type Candidate,
  CandidateSchema,
  type CreateCandidateInput,
  CreateCandidateInput as CreateCandidateInputSchema,
  normalizeKeyword,
} from '@shared/schemas';
import { type Document, ObjectId, type WithId } from 'mongodb';
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

  async listByOrg(
    orgId: string,
    opts: { status?: Candidate['status'] } = {},
  ): Promise<Candidate[]> {
    const query: Document = { org_id: orgId };
    if (opts.status) query.status = opts.status;
    const docs = await (await collection())
      .find(query)
      .sort({ opportunity_score: -1, created_at: 1 })
      .toArray();
    return docs.map(toEntity);
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
};
