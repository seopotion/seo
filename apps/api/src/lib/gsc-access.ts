import { GscConnectionRepo } from '@shared/db';
import { isGscConnected } from '@shared/schemas';
import { decryptSecret } from './crypto';
import { getGscTokenKey } from './secrets';

/**
 * The GSC gate (#12): decrypt the org's refresh token when a healthy, finalized
 * connection exists; null keeps the caller on the gated response shape.
 */
export async function gscAccess(
  org_id: string,
): Promise<{ token: string; siteUrl: string } | null> {
  const conn = await GscConnectionRepo.findByOrgId(org_id);
  if (!isGscConnected(conn)) return null;
  return {
    token: decryptSecret(conn.refresh_token_enc, await getGscTokenKey()),
    siteUrl: conn.site_url,
  };
}
