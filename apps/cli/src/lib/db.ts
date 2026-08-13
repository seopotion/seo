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
import {
  type PipelineConfig,
  resolveConfig,
  runKeywordPipeline,
  type StageModels,
} from '@shared/keywords';
import {
  createDataForSeoClient,
  createLemonSqueezyProvider,
  createOpenRouterClient,
  resolveProviderSecret,
} from '@shared/providers';
import { createStrategyRun, launchStrategy, runLocalStrategy } from '@shared/strategy';
import { ENTITLEMENT_PLANS, type EntitlementPlan } from '@shared/types';
import {
  type DbInitData,
  type DeleteUserData,
  fail,
  ok,
  type ResetUserData,
  type Result,
  type SetPlanData,
  type StrategyAuditData,
  type StrategyDryRunData,
  type StrategyRunData,
} from '../types';
import { buildStrategyAudit } from './strategy-audit';
import { buildDryRunReport, LAMBDA_BUDGET_MS } from './strategy-dryrun';
import {
  configDrift,
  createRecordingClients,
  createReplayClients,
  type ProviderClients,
  type ReplaySession,
  readSnapshot,
  SNAPSHOT_VERSION,
  type StrategySnapshot,
  writeSnapshot,
} from './strategy-snapshot';

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
 * Resolve the target org from exactly one of `org` (id, taken as-is) or `user`
 * (email -> their single org). Shared by every org-scoped db subcommand so they
 * accept the same flags and fail with the same codes.
 */
async function resolveOrgId(org?: string, user?: string): Promise<Result<string>> {
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
  try {
    const resolved = await resolveOrgId(org, user);
    if (!resolved.ok) return resolved;
    const orgId = resolved.data;

    const matched = await OrgRepo.setPlan(orgId, plan);
    if (!matched) return fail('ORG_NOT_FOUND', `No org with id "${orgId}".`);

    // Flipping the plan alone doesn't start anything: the keyword/article
    // pipeline is only ever bootstrapped by the strategy launcher, which
    // POST /setup/finalize triggers for orgs paid *at finalize time*. Escalating
    // to paid afterwards would otherwise leave the org permanently dormant, so
    // kick off the strategy here the same way finalize does — claimStrategy keeps
    // it to exactly one job across retries / a later re-finalize.
    // Field/code names predate the SQS→SFN switch (#56) — kept as-is (surgical
    // changes: nothing here forces a rename) even though "enqueued" no longer
    // literally describes launchStrategy's in-process/SFN dispatch.
    let strategyEnqueued = false;
    if (plan === 'paid' || plan === 'expert') {
      const org = await OrgRepo.findById(orgId);
      const finalized = org?.setup_status === 'setup_complete' && !!org.presets;
      if (finalized && (await OrgRepo.claimStrategy(orgId))) {
        try {
          await launchStrategy(orgId);
          strategyEnqueued = true;
        } catch (e) {
          // The claim already flipped strategy_status to `pending`; revert it so
          // a later re-run can reclaim, and surface the failure — the plan is set
          // but the pipeline did not start.
          await OrgRepo.setStrategyStatus(orgId, 'failed');
          return fail(
            'STRATEGY_ENQUEUE_FAILED',
            `Plan set to paid, but launching the strategy run failed: ${(e as Error).message}`,
            'Re-run set-plan to retry.',
          );
        }
      }
    }
    return ok({ org_id: orgId, plan, strategy_enqueued: strategyEnqueued });
  } finally {
    await closeDb();
  }
}

/**
 * Read-only diagnostics for the 30-day strategy plan (#211): the whole candidate
 * pool (every status) plus the scheduled planner entries, reduced to histograms
 * and named findings. Writes nothing — every call here is a read.
 */
export async function strategyAudit(input: {
  org?: string;
  user?: string;
  keywords: string[];
}): Promise<Result<StrategyAuditData>> {
  try {
    const resolved = await resolveOrgId(input.org, input.user);
    if (!resolved.ok) return resolved;

    const org = await OrgRepo.findById(resolved.data);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id "${resolved.data}".`);

    const { candidates } = await CandidateRepo.listByOrg(org.id);
    const keywords = await KeywordRepo.listByOrg(org.id);

    return ok(buildStrategyAudit({ org, candidates, keywords, needles: input.keywords }));
  } finally {
    await closeDb();
  }
}

/** Live DataForSEO + OpenRouter, resolved the way apps/worker/src/providers.ts does. */
async function liveStrategyClients(): Promise<Result<ProviderClients>> {
  const [login, password, apiKey] = await Promise.all([
    resolveProviderSecret('DATAFORSEO_LOGIN'),
    resolveProviderSecret('DATAFORSEO_PASSWORD'),
    resolveProviderSecret('OPENROUTER_API_KEY'),
  ]);
  const missing = [
    ['DATAFORSEO_LOGIN', login],
    ['DATAFORSEO_PASSWORD', password],
    ['OPENROUTER_API_KEY', apiKey],
  ]
    .filter(([, v]) => !v)
    .map(([name]) => name as string);
  if (missing.length > 0) {
    return fail(
      'PROVIDER_CREDENTIALS_MISSING',
      `Live mode needs provider credentials; unset: ${missing.join(', ')}.`,
      'Set them in the root .env, or re-run against a recorded snapshot with --replay <path>.',
    );
  }
  return ok({
    dataForSeo: createDataForSeoClient({ login, password }),
    llm: createOpenRouterClient({ apiKey }),
  });
}

/**
 * Run the real keyword pipeline for one org and report what it produced (#211).
 * Persists NOTHING — no candidates, no planner entries, no strategy_status — so
 * it is safe to run repeatedly while iterating on scoring and selection. The
 * only Mongo access is reading the org.
 */
export async function strategyDryRun(input: {
  org?: string;
  user?: string;
  serpTopN?: number;
  /** Pin the seed list so two runs are comparable; empty means ask the LLM. */
  seeds?: string[];
  /** Per-stage model overrides; unset stages keep the client default. */
  models?: StageModels;
  snapshotPath?: string;
  replayPath?: string;
  allowLiveMisses?: boolean;
}): Promise<Result<StrategyDryRunData>> {
  if (input.snapshotPath && input.replayPath) {
    return fail(
      'BAD_ARGS',
      'Pass either --snapshot (record live) or --replay (no network), not both.',
    );
  }
  if (input.allowLiveMisses && !input.replayPath) {
    return fail('BAD_ARGS', '--allow-live-misses only applies to --replay <path>.');
  }
  try {
    // Read the snapshot first: it names the org it was recorded for, so a replay
    // needs neither --org nor --user.
    let snapshot: StrategySnapshot | null = null;
    if (input.replayPath) {
      try {
        snapshot = await readSnapshot(input.replayPath);
      } catch (e) {
        return fail('SNAPSHOT_UNREADABLE', (e as Error).message);
      }
    }

    let orgId: string;
    if (snapshot && !input.org && !input.user) {
      orgId = snapshot.org_id;
    } else {
      const resolved = await resolveOrgId(input.org, input.user);
      if (!resolved.ok) return resolved;
      orgId = resolved.data;
    }

    const org = await OrgRepo.findById(orgId);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id "${orgId}".`);
    if (!org.presets) {
      return fail(
        'ORG_NOT_FINALIZED',
        `Org "${org.id}" has no presets, so the strategy job would skip it entirely.`,
      );
    }

    const partial: Partial<PipelineConfig> = {
      ...(input.serpTopN === undefined ? {} : { serpTopN: input.serpTopN }),
      ...(input.seeds?.length ? { seeds: input.seeds } : {}),
      ...(input.models && Object.keys(input.models).length ? { models: input.models } : {}),
    };
    const config = resolveConfig(org.presets, partial);

    let clients: ProviderClients;
    let recorded: ReturnType<typeof createRecordingClients>['recorded'] | null = null;
    let replay: ReplaySession | null = null;
    let drift: string[] = [];
    if (snapshot) {
      drift = configDrift(snapshot.config, config);
      let live: ProviderClients | undefined;
      if (input.allowLiveMisses) {
        const res = await liveStrategyClients();
        if (!res.ok) return res;
        live = res.data;
      }
      replay = createReplayClients(snapshot, live);
      clients = replay.clients;
    } else {
      const live = await liveStrategyClients();
      if (!live.ok) return live;
      if (input.snapshotPath) {
        const recorder = createRecordingClients(live.data);
        clients = recorder.clients;
        recorded = recorder.recorded;
      } else {
        clients = live.data;
      }
    }

    // The seeds the run actually used; only known once gather has run, so a
    // failed run falls back to whatever the replayed file already recorded.
    let usedSeeds: string[] | undefined;

    // Fold anything the miss path fetched back into the snapshot file — including
    // after a failed run, so the credits already spent are not wasted.
    const persistTopUp = async (): Promise<void> => {
      if (!replay || !input.replayPath) return;
      const misses = replay.misses();
      if (misses.dataforseo + misses.llm === 0) return;
      await writeSnapshot(input.replayPath, {
        version: SNAPSHOT_VERSION,
        recorded_at: new Date().toISOString(),
        org_id: org.id,
        website_url: org.website_url,
        // The merged file now holds calls made under the current config, so it
        // records that one; this run already reported the drift against the old.
        config,
        seeds: usedSeeds ?? snapshot?.seeds,
        ...replay.merged(),
      });
    };

    // Stage marks are taken at each stage's entry, so a mark's duration runs to
    // the next mark (or to the end for the last one).
    const marks: { stage: string; at: number }[] = [];
    const startedAt = Date.now();

    let result: Awaited<ReturnType<typeof runKeywordPipeline>>;
    try {
      result = await runKeywordPipeline({
        onProgress: (stage) => marks.push({ stage, at: Date.now() }),
        orgId: org.id,
        websiteUrl: org.website_url,
        presets: org.presets,
        competitors: org.presets.audience.competitors,
        // A first run for the org: nothing on the planner, so no cannibalization
        // penalty. Keeps two dry runs comparable across code changes.
        existingKeywords: [],
        existingArticleKeywords: [],
        clients,
        config: partial,
      });
    } catch (e) {
      await persistTopUp();
      return fail(
        'PIPELINE_FAILED',
        (e as Error).message,
        input.replayPath
          ? 'The snapshot does not cover this run — re-record it with --snapshot <path>, or top it up with --allow-live-misses.'
          : undefined,
      );
    }

    usedSeeds = result.stats.seeds;

    if (input.snapshotPath && recorded) {
      const calls = recorded();
      await writeSnapshot(input.snapshotPath, {
        version: SNAPSHOT_VERSION,
        recorded_at: new Date().toISOString(),
        org_id: org.id,
        website_url: org.website_url,
        config,
        seeds: usedSeeds,
        ...calls,
      });
    }
    await persistTopUp();

    return ok(
      buildDryRunReport({
        org,
        candidates: result.candidates,
        stats: result.stats,
        config,
        mode: input.replayPath ? 'replay' : 'live',
        startDate: new Date(),
        timing: {
          total_ms: Date.now() - startedAt,
          budget_ms: LAMBDA_BUDGET_MS,
          stages: marks.map((m, i) => ({
            stage: m.stage,
            ms: (marks[i + 1]?.at ?? Date.now()) - m.at,
          })),
        },
        snapshot: {
          wrote: input.snapshotPath ?? null,
          replayed: input.replayPath ?? null,
          config_drift: drift,
          live_misses: input.allowLiveMisses && replay ? replay.misses() : null,
        },
      }),
    );
  } finally {
    await closeDb();
  }
}

/**
 * Create and execute a REAL strategy run for one org, in-process (#56): persists
 * candidates, schedules planner entries, writes a strategy_runs doc. The recovery
 * path for a failed org — unlike setOrgPlan's kickoff, NOT gated by claimStrategy,
 * so it can re-run an org regardless of strategy_status. Needs Mongo + provider
 * credentials in the environment.
 */
export async function strategyRun(input: { orgId: string }): Promise<Result<StrategyRunData>> {
  try {
    const org = await OrgRepo.findById(input.orgId);
    if (!org) return fail('ORG_NOT_FOUND', `No org with id "${input.orgId}".`);
    if (!org.presets) {
      return fail(
        'ORG_NOT_FINALIZED',
        `Org "${org.id}" has no presets, so the strategy job would skip it entirely.`,
      );
    }

    const run = await createStrategyRun(org.id);
    await runLocalStrategy(run.id);
    return ok({ run_id: run.id });
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
