import { OrgRepo } from '@shared/db';
import { isPaid, type Org } from '@shared/schemas';

export type OwnedPaidResult =
  | { ok: true; org: Org }
  | { ok: false; reason: 'not_found' | 'not_owner' | 'not_paid' };

/**
 * Load an org that the caller owns AND that has an active paid entitlement.
 * `not_found` and `not_owner` are distinct so handlers can 404 vs 403; `not_paid`
 * maps to 402 so the client can route to billing. #13 later backs `isPaid`.
 */
export async function loadOwnedPaidOrg(orgId: string, userId: string): Promise<OwnedPaidResult> {
  const org = await OrgRepo.findById(orgId);
  if (!org) return { ok: false, reason: 'not_found' };
  if (org.user_id !== userId) return { ok: false, reason: 'not_owner' };
  if (!isPaid(org)) return { ok: false, reason: 'not_paid' };
  return { ok: true, org };
}
