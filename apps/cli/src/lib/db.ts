/**
 * Database management. initDb wraps ensureIndexes() (the `db:init` script's
 * logic) behind the Result contract; setOrgPlan is a dev/staging escape hatch
 * for the paid-entitlement gate while Stripe billing (#13) is unbuilt.
 */
import { closeDb, ensureIndexes, OrgRepo, UserRepo } from '@shared/db';
import { ENTITLEMENT_PLANS, type EntitlementPlan } from '@shared/types';
import { type DbInitData, fail, ok, type Result, type SetPlanData } from '../types';

export async function initDb(): Promise<Result<DbInitData>> {
  try {
    await ensureIndexes();
    return ok({ collections: ['users', 'orgs'] });
  } catch (e) {
    return fail(
      'DB_INIT_FAILED',
      (e as Error).message,
      'Is MongoDB running? Try `docker compose up -d mongo`.',
    );
  } finally {
    await closeDb();
  }
}

function isEntitlementPlan(plan: string): plan is EntitlementPlan {
  return (ENTITLEMENT_PLANS as readonly string[]).includes(plan);
}

/**
 * Override an org's entitlement plan. Targets the org directly (`org`) or the
 * single org owned by a user (`user` email). Operates against whatever
 * `MONGODB_URI` is configured — the caller is responsible for pointing it at
 * the intended environment.
 */
export async function setOrgPlan(input: {
  org?: string;
  user?: string;
  plan: string;
}): Promise<Result<SetPlanData>> {
  const { org, user, plan } = input;

  if (!isEntitlementPlan(plan)) {
    return fail(
      'INVALID_PLAN',
      `Unknown plan "${plan}".`,
      `Use one of: ${ENTITLEMENT_PLANS.join(', ')}.`,
    );
  }
  if ((org && user) || (!org && !user)) {
    return fail('BAD_TARGET', 'Provide exactly one of --org or --user.');
  }

  try {
    let orgId = org;
    if (user) {
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
      orgId = only.id;
    }

    const matched = await OrgRepo.setPlan(orgId as string, plan);
    if (!matched) return fail('ORG_NOT_FOUND', `No org with id "${orgId}".`);
    return ok({ org_id: orgId as string, plan });
  } finally {
    await closeDb();
  }
}
