import { getDb } from './client';

/**
 * Idempotent index setup — run at deploy time (CDK-invoked one-off Lambda or a
 * script), never lazily per request. `createIndex` is safe to re-run.
 * See design/data-layer.md ("Indexes").
 */
export async function ensureIndexes(): Promise<void> {
  const db = await getDb();
  await db.collection('users').createIndex({ google_sub: 1 }, { unique: true });
  // Compound index covers both findByUserId (user_id prefix) and the idempotent
  // start_scan lookup (OrgRepo.findActiveByUserAndUrl, user_id + website_url).
  await db.collection('orgs').createIndex({ user_id: 1, website_url: 1 });
  await db.collection('orgs').createIndex({ website_url: 1 });
  await db.collection('keywords').createIndex({ org_id: 1, scheduled_date: 1 });
  await db.collection('articles').createIndex({ org_id: 1, created_at: -1 });
  await db.collection('articles').createIndex({ org_id: 1, status: 1 });
  await db
    .collection('candidates')
    .createIndex({ org_id: 1, normalized_keyword: 1 }, { unique: true });
  await db.collection('candidates').createIndex({ org_id: 1, status: 1 });
  await db.collection('candidates').createIndex({ org_id: 1, opportunity_score: -1 });
}
