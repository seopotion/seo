/**
 * Database management. initDb wraps ensureIndexes() (the `db:init` script's
 * logic) behind the Result contract; setOrgPlan is a dev/staging escape hatch
 * for the paid-entitlement gate while Stripe billing (#13) is unbuilt.
 */
import {
  ArticleRepo,
  CandidateRepo,
  closeDb,
  ensureIndexes,
  KeywordRepo,
  type MigrationReport,
  OrgRepo,
  runMigrations,
  UserRepo,
} from '@shared/db';
import { ENTITLEMENT_PLANS, type EntitlementPlan } from '@shared/types';
import {
  type DbInitData,
  fail,
  ok,
  type ResetUserData,
  type Result,
  type SetPlanData,
} from '../types';

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

/** Run idempotent data migrations (#99) — always before `db init` on deploy. */
export async function migrateDb(): Promise<Result<MigrationReport>> {
  try {
    const report = await runMigrations();
    return ok(report);
  } catch (e) {
    return fail(
      'DB_MIGRATE_FAILED',
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

    // Flipping the plan alone doesn't start anything: the keyword/article
    // pipeline is only ever bootstrapped by the strategy worker, which
    // POST /setup/finalize enqueues for orgs paid *at finalize time*. Escalating
    // to paid afterwards would otherwise leave the org permanently dormant, so
    // kick off the strategy here the same way finalize does — claimStrategy keeps
    // it to exactly one job across retries / a later re-finalize.
    let strategyEnqueued = false;
    if (plan === 'paid' || plan === 'expert') {
      const org = await OrgRepo.findById(orgId as string);
      const finalized = org?.setup_status === 'setup_complete' && !!org.presets;
      if (finalized && (await OrgRepo.claimStrategy(orgId as string))) {
        try {
          const { enqueueStrategyTask } = await import('./sqs');
          await enqueueStrategyTask({ org_id: orgId as string });
          strategyEnqueued = true;
        } catch (e) {
          // The claim already flipped strategy_status to `pending`; revert it so
          // a later re-run can reclaim, and surface the failure — the plan is set
          // but the pipeline did not start.
          await OrgRepo.setStrategyStatus(orgId as string, 'failed');
          return fail(
            'STRATEGY_ENQUEUE_FAILED',
            `Plan set to paid, but enqueueing the strategy task failed: ${(e as Error).message}`,
            'Is STRATEGY_QUEUE_URL set (and SQS reachable)? Re-run set-plan to retry.',
          );
        }
      }
    }
    return ok({ org_id: orgId as string, plan, strategy_enqueued: strategyEnqueued });
  } finally {
    await closeDb();
  }
}

/**
 * Delete a user's orgs and all org-scoped data (keywords, candidates,
 * articles) so the next login re-runs onboarding. The user document stays —
 * login recreates session state and the onboarding gate is org-presence.
 * Idempotent: a user with no orgs is a success with zero counts. Operates
 * against whatever `MONGODB_URI` is configured.
 */
export async function resetUser(input: { user?: string }): Promise<Result<ResetUserData>> {
  const { user } = input;
  if (!user) return fail('BAD_TARGET', 'Provide --user <email>.');

  try {
    const found = await UserRepo.findByEmail(user);
    if (!found) return fail('USER_NOT_FOUND', `No user with email "${user}".`);

    const orgs = await OrgRepo.findByUserId(found.id);
    const deleted = { orgs: 0, keywords: 0, candidates: 0, articles: 0 };
    for (const org of orgs) {
      deleted.keywords += await KeywordRepo.deleteByOrgId(org.id);
      deleted.candidates += await CandidateRepo.deleteByOrgId(org.id);
      deleted.articles += await ArticleRepo.deleteByOrgId(org.id);
      if (await OrgRepo.deleteById(org.id)) deleted.orgs += 1;
    }
    return ok({ user_id: found.id, org_ids: orgs.map((o) => o.id), deleted });
  } finally {
    await closeDb();
  }
}
