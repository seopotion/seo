import { createHash } from 'node:crypto';
import { GscAnalyticsCacheRepo } from '@shared/db';
import {
  querySearchAnalytics,
  type SearchAnalyticsParams,
  type SearchAnalyticsRow,
} from '../clients/gsc';
import { logger } from '../logger';

/**
 * Deterministic cache key for one GSC searchAnalytics query (#208): sha256 of
 * site_url + every field of the query body, in fixed insertion order so the
 * same query always serializes to the same JSON.
 */
export function cacheKey(siteUrl: string, params: SearchAnalyticsParams): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        site_url: siteUrl,
        startDate: params.startDate,
        endDate: params.endDate,
        dimensions: params.dimensions ?? null,
        dimensionFilterGroups: params.dimensionFilterGroups ?? null,
        rowLimit: params.rowLimit ?? null,
      }),
    )
    .digest('hex');
}

/**
 * Read-through 48h cache over the GSC Search Analytics query (#208): hit →
 * stored rows; miss → live call, store, return. Errors from the live GSC call
 * (including GscAuthRevokedError) propagate and are never cached. Cache-layer
 * failures (Mongo blip on read, E11000 upsert race on write) are logged and
 * swallowed — they must never gate a healthy GSC connection.
 */
export async function cachedSearchAnalytics(
  orgId: string,
  access: { token: string; siteUrl: string },
  params: SearchAnalyticsParams,
): Promise<SearchAnalyticsRow[]> {
  const key = cacheKey(access.siteUrl, params);
  let hit: SearchAnalyticsRow[] | null = null;
  try {
    hit = await GscAnalyticsCacheRepo.get(key);
  } catch (err) {
    logger.warn('GSC cache read failed', { error: err as Error });
  }
  if (hit !== null) return hit;
  const rows = await querySearchAnalytics(access.token, access.siteUrl, params);
  await GscAnalyticsCacheRepo.put(key, orgId, rows).catch((err) => {
    logger.warn('GSC cache write failed', { error: err as Error });
  });
  return rows;
}
