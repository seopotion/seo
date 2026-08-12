import { z } from 'zod';

/**
 * Google Search Console connection — one per org (#12). The refresh token is
 * stored AES-256-GCM-encrypted (apps/api/src/lib/crypto.ts); `site_url` is
 * null between the OAuth code exchange and the user's property pick.
 */
export const GscConnectionSchema = z.object({
  id: z.string(),
  org_id: z.string(),
  refresh_token_enc: z.string(),
  site_url: z.string().nullable(),
  google_email: z.string(),
  connected_at: z.date(),
  last_refresh_failed_at: z.date().nullable(),
});
export type GscConnection = z.infer<typeof GscConnectionSchema>;

/**
 * The GSC gate (#12): connected iff the property is chosen and the last token
 * refresh didn't fail. Gates the Home Best Articles / Search Performance cards.
 */
export function isGscConnected(
  conn: GscConnection | null,
): conn is GscConnection & { site_url: string } {
  return conn !== null && conn.site_url !== null && conn.last_refresh_failed_at === null;
}

/** One Search Analytics result row, as cached (#208). Mirrors the GSC API row. */
export const GscAnalyticsRowSchema = z.object({
  keys: z.array(z.string()),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number(),
  position: z.number(),
});
export type GscAnalyticsRow = z.infer<typeof GscAnalyticsRowSchema>;

/**
 * Cached GSC searchAnalytics response (#208). `key` is a deterministic hash of
 * site_url + the full query body; a unique index makes concurrent fills safe
 * and a TTL index on `created_at` expires entries after 48h (GSC data
 * refreshes ~daily, so 48h staleness is acceptable and cuts quota use).
 */
export const GscAnalyticsCacheSchema = z.object({
  id: z.string(),
  key: z.string(),
  org_id: z.string(),
  rows: z.array(GscAnalyticsRowSchema),
  created_at: z.date(),
});
export type GscAnalyticsCache = z.infer<typeof GscAnalyticsCacheSchema>;
