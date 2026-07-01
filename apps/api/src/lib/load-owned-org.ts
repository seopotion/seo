import { OrgRepo } from '@shared/db';
import type { Org } from '@shared/schemas';

/**
 * Load an org only if it belongs to the given user. Returns `null` when the org
 * is missing OR owned by someone else — callers map both to 404 so org
 * existence is never leaked across accounts.
 */
export async function loadOwnedOrg(org_id: string, userId: string): Promise<Org | null> {
  const org = await OrgRepo.findById(org_id);
  if (!org || org.user_id !== userId) return null;
  return org;
}
