/**
 * Resolve the target org from exactly one of `org` (id, taken as-is) or `user`
 * (email -> their single org). Shared by every org-scoped subcommand so they
 * accept the same flags and fail with the same codes.
 */
import { OrgRepo, UserRepo } from '@shared/db';
import { fail, ok, type Result } from '../types';

export async function resolveOrgId(org?: string, user?: string): Promise<Result<string>> {
  if ((org && user) || (!org && !user)) {
    return fail('BAD_TARGET', 'Provide exactly one of --org or --user.');
  }
  if (!user) return ok(org as string);

  const found = await UserRepo.findByEmail(user);
  if (!found) return fail('USER_NOT_FOUND', `No user with email "${user}".`);
  const orgs = await OrgRepo.findByUserId(found.id);
  if (orgs.length > 1) {
    return fail(
      'AMBIGUOUS_ORG',
      `User "${user}" owns ${orgs.length} orgs: ${orgs.map((o) => o.id).join(', ')}.`,
      'Re-run with --org <id>.',
    );
  }
  const [only] = orgs;
  if (!only) return fail('ORG_NOT_FOUND', `User "${user}" owns no org.`);
  return ok(only.id);
}
