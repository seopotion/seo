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
  GscConnectionRepo,
  KeywordRepo,
  type MigrationReport,
  OrgRepo,
  runMigrations,
  SubscriptionRepo,
  UserRepo,
} from '@shared/db';
import { createLemonSqueezyProvider } from '@shared/providers';
import { ENTITLEMENT_PLANS, type EntitlementPlan } from '@shared/types';
import {
  type DbInitData,
  type DeleteUserData,
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
 * Cancel every active provider subscription for the given orgs BEFORE any data
 * is deleted — wiping local records must not leave the user being billed for a
 * product that no longer exists. Throws when a sub exists but the LemonSqueezy
 * API key is unset or the cancel call fails.
 */
async function cancelActiveSubscriptions(orgIds: string[]): Promise<number> {
  const active = (
    await Promise.all(orgIds.map((id) => SubscriptionRepo.listActiveByOrg(id)))
  ).flat();
  if (active.length === 0) return 0;

  const apiKey = process.env.LEMONSQUEEZY_API_KEY ?? '';
  if (!apiKey) {
    throw new Error(
      `${active.length} active subscription(s) exist but LEMONSQUEEZY_API_KEY is unset.`,
    );
  }
  // Only cancelSubscription is used — the other config fields are irrelevant here.
  const provider = createLemonSqueezyProvider({
    apiKey,
    webhookSecret: '',
    storeId: '',
    variantByTier: { paid: '', expert: '' },
    redirectUrl: '',
  });
  for (const sub of active) {
    await provider.cancelSubscription(sub.provider_subscription_id);
  }
  return active.length;
}

async function wipeUser(user: string | undefined, alsoDeleteUser: boolean) {
  if (!user) return fail('BAD_TARGET', 'Provide --user <email>.');

  const found = await UserRepo.findByEmail(user);
  if (!found) return fail('USER_NOT_FOUND', `No user with email "${user}".`);

  const orgs = await OrgRepo.findByUserId(found.id);
  const orgIds = orgs.map((o) => o.id);

  let cancelled: number;
  try {
    cancelled = await cancelActiveSubscriptions(orgIds);
  } catch (e) {
    return fail(
      'SUB_CANCEL_FAILED',
      `Nothing was deleted: ${(e as Error).message}`,
      'Set LEMONSQUEEZY_API_KEY (matching the targeted env), or cancel the subscription in the LemonSqueezy dashboard first.',
    );
  }

  const deleted = {
    orgs: 0,
    keywords: 0,
    candidates: 0,
    articles: 0,
    gsc_connections: 0,
    subscriptions: 0,
  };
  for (const org of orgs) {
    deleted.keywords += await KeywordRepo.deleteByOrgId(org.id);
    deleted.candidates += await CandidateRepo.deleteByOrgId(org.id);
    deleted.articles += await ArticleRepo.deleteByOrgId(org.id);
    if (await GscConnectionRepo.deleteByOrgId(org.id)) deleted.gsc_connections += 1;
    deleted.subscriptions += await SubscriptionRepo.deleteByOrgId(org.id);
    if (await OrgRepo.deleteById(org.id)) deleted.orgs += 1;
  }

  const base: ResetUserData = {
    user_id: found.id,
    org_ids: orgIds,
    cancelled_subscriptions: cancelled,
    deleted,
  };
  if (!alsoDeleteUser) return ok(base);
  const user_deleted = await UserRepo.deleteById(found.id);
  return ok({ ...base, user_deleted });
}

/**
 * Delete a user's orgs and all org-scoped data (keywords, candidates, articles,
 * GSC connections, subscriptions — cancelling active provider subs first) so
 * the next login re-runs onboarding. The user document stays — login recreates
 * session state and the onboarding gate is org-presence. Idempotent: a user
 * with no orgs is a success with zero counts. Operates against whatever
 * `MONGODB_URI` is configured.
 */
export async function resetUser(input: { user?: string }): Promise<Result<ResetUserData>> {
  try {
    return (await wipeUser(input.user, false)) as Result<ResetUserData>;
  } finally {
    await closeDb();
  }
}

/** Like resetUser, but also removes the user document itself — a full nuke. */
export async function deleteUser(input: { user?: string }): Promise<Result<DeleteUserData>> {
  try {
    return (await wipeUser(input.user, true)) as Result<DeleteUserData>;
  } finally {
    await closeDb();
  }
}
