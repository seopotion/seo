import { isPaid, type Org } from '@shared/schemas';
import type { AuthContext } from '../middlewares/auth';
import { loadOrgForUser } from './load-org-for-user';

export type OwnedPaidResult =
  | { ok: true; org: Org }
  | { ok: false; reason: 'not_found' | 'not_paid' };

/**
 * Load an org the caller may act on (owner or member, #333) AND that has an
 * active paid entitlement. Missing and inaccessible orgs are both `not_found`
 * (404) so existence never leaks; `not_paid` maps to 402 so the client can
 * route to billing.
 */
export async function loadOwnedPaidOrg(orgId: string, auth: AuthContext): Promise<OwnedPaidResult> {
  const access = await loadOrgForUser(orgId, auth);
  if (!access) return { ok: false, reason: 'not_found' };
  if (!isPaid(access.org)) return { ok: false, reason: 'not_paid' };
  return { ok: true, org: access.org };
}
