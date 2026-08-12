import {
  type GscAnalyticsCache,
  GscAnalyticsCacheSchema,
  type GscAnalyticsRow,
} from '@shared/schemas';
import type { Document, WithId } from 'mongodb';
import { getDb } from '../client';

const collection = async () => (await getDb()).collection('gsc_analytics_cache');

/** Map a Mongo document to a validated entity (`_id` -> string `id`). */
function toEntity(doc: WithId<Document>): GscAnalyticsCache {
  const { _id, ...rest } = doc;
  return GscAnalyticsCacheSchema.parse({ id: _id.toString(), ...rest });
}

export const GscAnalyticsCacheRepo = {
  /** Cached rows for a query key; null on a miss (an empty array is a hit). */
  async get(key: string): Promise<GscAnalyticsRow[] | null> {
    const doc = await (await collection()).findOne({ key });
    return doc ? toEntity(doc).rows : null;
  },

  /** Upsert a response. Refreshing `created_at` restarts the 48h TTL clock. */
  async put(key: string, orgId: string, rows: GscAnalyticsRow[]): Promise<void> {
    await (await collection()).updateOne(
      { key },
      { $set: { org_id: orgId, rows, created_at: new Date() } },
      { upsert: true },
    );
  },
};
