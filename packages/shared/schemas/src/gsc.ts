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
