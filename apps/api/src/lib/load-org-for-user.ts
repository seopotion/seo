import { OrgMemberRepo, OrgRepo } from '@shared/db';
import type { Org, OrgRole } from '@shared/schemas';
import type { AuthContext } from '../middlewares/auth';

export type OrgAccess = { org: Org; role: OrgRole };

/**
 * Load an org only if the caller owns it or is a member (#333). Returns `null`
 * when the org is missing OR the caller has no access — callers map both to
 * 404 so org existence is never leaked across accounts.
 */
export async function loadOrgForUser(org_id: string, auth: AuthContext): Promise<OrgAccess | null> {
  const org = await OrgRepo.findById(org_id);
  if (!org) return null;
  if (org.user_id === auth.userId) return { org, role: 'owner' };
  const member = await OrgMemberRepo.findByOrgAndEmail(org_id, auth.email.toLowerCase());
  return member ? { org, role: 'member' } : null;
}

/** `loadOrgForUser` for routes that do not care about the role. */
export async function loadAccessibleOrg(org_id: string, auth: AuthContext): Promise<Org | null> {
  return (await loadOrgForUser(org_id, auth))?.org ?? null;
}
