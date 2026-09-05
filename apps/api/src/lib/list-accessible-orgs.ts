import { OrgMemberRepo, OrgRepo } from '@shared/db';
import type { Org } from '@shared/schemas';
import type { AuthContext } from '../middlewares/auth';

/** Orgs the caller owns plus the ones they were added to by email (#333). */
export async function listAccessibleOrgs(auth: AuthContext): Promise<Org[]> {
  const memberOrgIds = await OrgMemberRepo.listOrgIdsByEmail(auth.email.toLowerCase());
  return OrgRepo.findAccessible(auth.userId, memberOrgIds);
}
