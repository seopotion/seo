import {
  type CreateStrategyRunInput,
  CreateStrategyRunInput as CreateStrategyRunInputSchema,
  type StageState,
  type StrategyRun,
  StrategyRunSchema,
  type StrategyStageName,
  type WorkingCandidate,
} from '@shared/schemas';
import { ObjectId } from 'mongodb';
import { getDb } from '../client';

const COLLECTION = 'strategy_runs';

type StrategyRunDoc = Omit<StrategyRun, 'id'> & { _id: ObjectId };

function toRun(doc: StrategyRunDoc): StrategyRun {
  const { _id, ...rest } = doc;
  return StrategyRunSchema.parse({ ...rest, id: _id.toHexString() });
}

export interface StrategyWorkStatePatch {
  candidates: WorkingCandidate[];
  below_n: WorkingCandidate[];
  rejected: WorkingCandidate[];
  seeds: string[];
  stats: Record<string, unknown>;
}

export const StrategyRunRepo = {
  async create(input: CreateStrategyRunInput): Promise<StrategyRun> {
    const db = await getDb();
    const now = new Date();
    const data = CreateStrategyRunInputSchema.parse(input);
    const { insertedId } = await db
      .collection<Omit<StrategyRunDoc, '_id'>>(COLLECTION)
      .insertOne({ ...data, created_at: now, updated_at: now });
    return toRun({ ...data, created_at: now, updated_at: now, _id: insertedId });
  },

  async findById(id: string): Promise<StrategyRun | null> {
    if (!ObjectId.isValid(id)) return null;
    const db = await getDb();
    const doc = await db.collection<StrategyRunDoc>(COLLECTION).findOne({ _id: new ObjectId(id) });
    return doc ? toRun(doc) : null;
  },

  async latestByOrg(orgId: string): Promise<StrategyRun | null> {
    const db = await getDb();
    const doc = await db
      .collection<StrategyRunDoc>(COLLECTION)
      .findOne({ org_id: orgId }, { sort: { created_at: -1 } });
    return doc ? toRun(doc) : null;
  },

  async saveStageResult(
    id: string,
    stage: StrategyStageName,
    state: StrategyWorkStatePatch,
    meta: StageState,
  ): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db.collection<StrategyRunDoc>(COLLECTION).updateOne(
      // Fenced against a stale writer (final-review finding 2): a zombie Lambda
      // whose SFN taskTimeout already fired can still run to completion and
      // clobber a newer checkpoint written by the successful retry. Once a stage
      // is marked completed, no further write to it is accepted.
      { _id: new ObjectId(id), [`stages.${stage}.status`]: { $ne: 'completed' } },
      { $set: { ...state, [`stages.${stage}`]: meta, updated_at: new Date() } },
    );
  },

  async markStageFailed(id: string, stage: StrategyStageName, meta: StageState): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db
      .collection<StrategyRunDoc>(COLLECTION)
      .updateOne(
        { _id: new ObjectId(id) },
        { $set: { [`stages.${stage}`]: meta, updated_at: new Date() } },
      );
  },

  async setStatus(id: string, status: StrategyRun['status']): Promise<void> {
    if (!ObjectId.isValid(id)) return;
    const db = await getDb();
    await db
      .collection<StrategyRunDoc>(COLLECTION)
      .updateOne({ _id: new ObjectId(id) }, { $set: { status, updated_at: new Date() } });
  },
};
