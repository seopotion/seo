/**
 * db command — database management.
 */
import { defineCommand } from 'citty';
import { EXIT, fail, type OutputMode } from '../types';
import { createEmitter } from '../utils/emitter';
import { emitInternal, outputOption, verboseOption } from './shared';

export const dbCommand = defineCommand({
  meta: { name: 'db', description: 'Database management' },
  subCommands: {
    init: defineCommand({
      meta: { name: 'init', description: 'Create MongoDB indexes (ensureIndexes)' },
      args: { ...outputOption, ...verboseOption },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { initDb } = await import('../lib/db');

          emitter.step('db:init', 'start');

          if (args.verbose) {
            emitter.info('Running ensureIndexes()');
          }

          const result = await initDb();
          emitter.step('db:init', result.ok ? 'done' : 'fail');
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.OP_FAILED);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    migrate: defineCommand({
      meta: { name: 'migrate', description: 'Run idempotent data migrations (before db init)' },
      args: { ...outputOption, ...verboseOption },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { migrateDb } = await import('../lib/db');

          emitter.step('db:migrate', 'start');

          if (args.verbose) {
            emitter.info('Running runMigrations()');
          }

          const result = await migrateDb();
          emitter.step('db:migrate', result.ok ? 'done' : 'fail');
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.OP_FAILED);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'set-plan': defineCommand({
      meta: {
        name: 'set-plan',
        description:
          "Override an org's entitlement plan (dev/staging escape hatch for the paywall)",
      },
      args: {
        org: { type: 'string', description: 'Org id to update' },
        user: { type: 'string', description: "Owner's email; resolves to their single org" },
        plan: { type: 'string', description: 'free | paid | expert', default: 'paid' },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { setOrgPlan } = await import('../lib/db');

          emitter.warn('Applies to whatever MONGO_URI targets — never run this against prod.');
          emitter.step('db:set-plan', 'start');

          const result = await setOrgPlan({
            org: args.org as string | undefined,
            user: args.user as string | undefined,
            plan: args.plan as string,
          });
          emitter.step('db:set-plan', result.ok ? 'done' : 'fail');
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'strategy-audit': defineCommand({
      meta: {
        name: 'strategy-audit',
        description:
          'Read-only report on why the 30-day plan scheduled what it did (#211): candidate-pool histograms, the scheduled plan, and named diagnostics. NOTE: the pool is the union of every strategy run for the org, so if the job has been re-run the histograms are approximate.',
      },
      args: {
        org: { type: 'string', description: 'Org id to audit' },
        user: { type: 'string', description: "Owner's email; resolves to their single org" },
        keyword: {
          type: 'string',
          description:
            'Dump full candidate records whose normalized_keyword contains this substring (case-insensitive). Repeatable or comma-separated.',
        },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { strategyAudit } = await import('../lib/db');
          const { renderStrategyAudit } = await import('../lib/strategy-audit');

          // citty collects a repeated flag into an array; also accept "a,b".
          const raw = args.keyword as string | string[] | undefined;
          const keywords = (Array.isArray(raw) ? raw : raw ? [raw] : [])
            .flatMap((k) => k.split(','))
            .map((k) => k.trim())
            .filter(Boolean);

          emitter.step('db:strategy-audit', 'start');

          const result = await strategyAudit({
            org: args.org as string | undefined,
            user: args.user as string | undefined,
            keywords,
          });
          emitter.step('db:strategy-audit', result.ok ? 'done' : 'fail');

          // The report is a page of tables, so text mode renders it instead of
          // dumping the raw JSON the default emitter would print.
          if (result.ok && args.output !== 'json') {
            process.stdout.write(renderStrategyAudit(result.data));
          } else {
            emitter.result(result);
          }

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'strategy-dryrun': defineCommand({
      meta: {
        name: 'strategy-dryrun',
        description:
          'Run the real keyword pipeline for one org and report the result (#211). Persists NOTHING — no candidates, no planner entries, no strategy_status. Record provider responses with --snapshot, then iterate for free with --replay.',
      },
      args: {
        org: { type: 'string', description: 'Org id to run for' },
        user: { type: 'string', description: "Owner's email; resolves to their single org" },
        'serp-top-n': {
          type: 'string',
          description: 'Override config.serpTopN — live SERP calls dominate the cost',
        },
        seeds: {
          type: 'string',
          description:
            'Pin the seed keywords (comma-separated, or repeat the flag) instead of asking the LLM. The seed call is non-deterministic and swings the pool +/-40%, so pin it for any A/B',
        },
        'model-seeds': {
          type: 'string',
          description: 'Model for the seed call only (default: the client default)',
        },
        'model-relevance': {
          type: 'string',
          description: 'Model for the relevance stage only (default: the client default)',
        },
        'model-plan': {
          type: 'string',
          description:
            'Model for the plan call (judgment + targets) only (default: the client default)',
        },
        snapshot: {
          type: 'string',
          description: 'Run live and record every provider response to this JSON file',
        },
        replay: {
          type: 'string',
          description:
            'Replay a recorded snapshot; makes no network calls at all. Implies the org it was recorded for, so --org/--user are optional',
        },
        'allow-live-misses': {
          type: 'boolean',
          description:
            'With --replay: fetch only the calls the snapshot lacks from the live providers and write the enlarged snapshot back',
          default: false,
        },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { strategyDryRun } = await import('../lib/db');
          const { renderStrategyDryRun } = await import('../lib/strategy-dryrun');
          const { DEFAULT_CONFIG } = await import('@shared/keywords');

          const rawTopN = args['serp-top-n'] as string | undefined;
          const serpTopN = rawTopN === undefined ? undefined : Number(rawTopN);
          if (serpTopN !== undefined && !Number.isInteger(serpTopN)) {
            emitter.result(fail('BAD_ARGS', `--serp-top-n must be an integer, got "${rawTopN}".`));
            process.exit(EXIT.USER_ERROR);
          }

          // citty collects a repeated flag into an array; also accept "a,b".
          const rawSeeds = args.seeds as string | string[] | undefined;
          const seeds = (Array.isArray(rawSeeds) ? rawSeeds : rawSeeds ? [rawSeeds] : [])
            .flatMap((s) => s.split(','))
            .map((s) => s.trim())
            .filter(Boolean);

          const models = Object.fromEntries(
            (
              [
                ['seeds', 'model-seeds'],
                ['relevance', 'model-relevance'],
                ['plan', 'model-plan'],
              ] as const
            )
              .map(([stage, flag]) => [stage, args[flag] as string | undefined])
              .filter(([, model]) => !!model),
          );

          const replay = args.replay as string | undefined;
          const allowLiveMisses = args['allow-live-misses'] as boolean;
          if (replay && allowLiveMisses) {
            emitter.warn(
              `Replaying ${replay} with --allow-live-misses — cached calls are free, but anything the snapshot lacks is fetched live and costs real credits. The snapshot is rewritten with what it fetched.`,
            );
          } else if (replay) {
            emitter.info(`Replaying ${replay} — no network calls, no provider credits spent.`);
          } else {
            emitter.warn(
              // The LLM count is no longer ~1 per keyword: relevance, the SERP
              // judge and classify are all batched (#211), so it is a few dozen
              // calls regardless of pool size.
              `LIVE RUN — real DataForSEO + OpenRouter credits will be spent: up to ${serpTopN ?? DEFAULT_CONFIG.serpTopN} SERP calls (serpTopN) plus the gather/difficulty calls, and a few dozen batched LLM calls. Pass --snapshot <path> to record it, then --replay <path> to iterate for free.`,
            );
          }
          emitter.step('db:strategy-dryrun', 'start');

          const result = await strategyDryRun({
            org: args.org as string | undefined,
            user: args.user as string | undefined,
            serpTopN,
            seeds,
            models,
            snapshotPath: args.snapshot as string | undefined,
            replayPath: replay,
            allowLiveMisses,
          });
          emitter.step('db:strategy-dryrun', result.ok ? 'done' : 'fail');

          // The report is a page of tables, so text mode renders it instead of
          // dumping the raw JSON the default emitter would print.
          if (result.ok && args.output !== 'json') {
            process.stdout.write(renderStrategyDryRun(result.data));
          } else {
            emitter.result(result);
          }

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'strategy-run': defineCommand({
      meta: {
        name: 'strategy-run',
        description:
          'Create and execute a REAL strategy run for one org, in-process (#56): persists candidates, ' +
          'schedules planner entries, writes a strategy_runs doc. The recovery path for a failed org. ' +
          'Needs Mongo + provider credentials in the environment.',
      },
      args: {
        org: { type: 'positional', description: 'Org id', required: true },
        force: {
          type: 'boolean',
          description:
            'Re-run an org whose strategy is already completed (or stuck pending): resets strategy_status to failed first. Tops up the plan; safe to repeat.',
          default: false,
        },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { strategyRun } = await import('../lib/db');

          emitter.warn(
            'Writes to whatever MONGO_URI targets and spends real provider credits — not a dry run.',
          );
          emitter.step('db:strategy-run', 'start');

          const result = await strategyRun({
            orgId: args.org as string,
            force: args.force as boolean,
          });
          emitter.step('db:strategy-run', result.ok ? 'done' : 'fail');
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'clean-links': defineCommand({
      meta: {
        name: 'clean-links',
        description: 'Unwrap dead internal links in existing articles (#186); dry run by default',
      },
      args: {
        org: { type: 'string', description: 'Org id to clean' },
        apply: {
          type: 'boolean',
          description: 'Write the changes (default: dry run)',
          default: false,
        },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { cleanLinks } = await import('../lib/links');

          emitter.warn(
            args.apply
              ? "Writes to whatever MONGO_URI targets — safe and intended for prod. Republish every published article it changes, or the customer's site keeps the dead links."
              : 'Dry run against whatever MONGO_URI targets — nothing is written. Safe and intended for prod; pass --apply to write.',
          );
          emitter.step('db:clean-links', 'start');

          const result = await cleanLinks({
            org: args.org as string | undefined,
            apply: args.apply as boolean,
          });
          emitter.step('db:clean-links', result.ok ? 'done' : 'fail');
          if (result.ok && result.data.publishedChanged.length) {
            emitter.warn(
              `${result.data.publishedChanged.length} PUBLISHED article(s) changed — republish them so the customer's site picks up the fix.`,
            );
          }
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'reset-images': defineCommand({
      meta: {
        name: 'reset-images',
        description:
          'Blank article images that point at a dead CDN host (e.g. the pre-migration ' +
          'account) so the image worker regenerates them; dry run by default',
      },
      args: {
        host: { type: 'string', description: 'Dead CDN host to match, e.g. dXXXX.cloudfront.net' },
        org: { type: 'string', description: 'Org id to scan (or use --article)' },
        article: { type: 'string', description: 'Single article id to reset' },
        apply: {
          type: 'boolean',
          description: 'Write the changes (default: dry run)',
          default: false,
        },
        enqueue: {
          type: 'boolean',
          description: 'With --apply, launch an image-repair run for each reset article',
          default: false,
        },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { resetImages } = await import('../lib/images');

          emitter.warn(
            args.apply
              ? 'Writes to whatever MONGO_URI targets. Regeneration bills the image provider and produces DIFFERENT images; republish every published article it touches.'
              : 'Dry run against whatever MONGO_URI targets — nothing is written. Pass --apply to write.',
          );
          emitter.step('db:reset-images', 'start');

          const result = await resetImages({
            host: args.host as string | undefined,
            org: args.org as string | undefined,
            article: args.article as string | undefined,
            apply: args.apply as boolean,
            enqueue: args.enqueue as boolean,
          });
          emitter.step('db:reset-images', result.ok ? 'done' : 'fail');
          if (result.ok && result.data.apply && !result.data.enqueued && result.data.reset.length) {
            emitter.warn(
              `${result.data.reset.length} article(s) blanked but NOT requeued — replay each with POST /admin/articles/{id}/images, or rerun with --enqueue.`,
            );
          }
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'set-post-base': defineCommand({
      meta: {
        name: 'set-post-base',
        description:
          "Set a static-site connection's post URL base (#228): a published post lives at <base>/<slug>",
      },
      args: {
        org: { type: 'string', description: 'Org id' },
        base: { type: 'string', description: 'http(s) URL posts are served under' },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { setPostBase } = await import('../lib/links');

          emitter.warn('Writes to whatever MONGO_URI targets — safe and intended for prod.');
          emitter.step('db:set-post-base', 'start');

          const result = await setPostBase({
            org: args.org as string | undefined,
            base: args.base as string | undefined,
          });
          emitter.step('db:set-post-base', result.ok ? 'done' : 'fail');
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'delete-org': defineCommand({
      meta: {
        name: 'delete-org',
        description:
          'Delete whole orgs and every org-scoped document (keywords, candidates, articles, ' +
          'GSC connections + cache, subscriptions, integrations, strategy runs), cancelling ' +
          'active LemonSqueezy subs first. Users are NOT touched, and the append-only ' +
          'admin_actions audit log is left intact. Dry run by default.',
      },
      args: {
        org: {
          type: 'string',
          description: 'Org id to delete. Repeatable or comma-separated.',
        },
        keep: {
          type: 'string',
          description:
            'Invert: delete EVERY org except these ids. Repeatable or comma-separated. ' +
            'An unknown id here aborts the whole sweep.',
        },
        apply: {
          type: 'boolean',
          description: 'Write the changes (default: dry run)',
          default: false,
        },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { deleteOrgs } = await import('../lib/db');

          // citty collects a repeated flag into an array; also accept "a,b".
          const list = (raw: string | string[] | undefined) =>
            (Array.isArray(raw) ? raw : raw ? [raw] : [])
              .flatMap((v) => v.split(','))
              .map((v) => v.trim())
              .filter(Boolean);

          emitter.warn(
            args.apply
              ? 'IRREVERSIBLE — deletes from whatever MONGO_URI targets. Never run this against prod.'
              : 'Dry run against whatever MONGO_URI targets — nothing is written. Pass --apply to delete.',
          );
          emitter.step('db:delete-org', 'start');

          const result = await deleteOrgs({
            orgs: list(args.org as string | string[] | undefined),
            keep: list(args.keep as string | string[] | undefined),
            apply: args.apply as boolean,
          });
          emitter.step('db:delete-org', result.ok ? 'done' : 'fail');
          if (result.ok && !result.data.apply) {
            emitter.warn(
              `${result.data.orgs.length} org(s) would be deleted, along with ${result.data.active_subscriptions} active subscription(s). Re-run with --apply.`,
            );
          }
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'delete-user': defineCommand({
      meta: {
        name: 'delete-user',
        description:
          'Nuke a user entirely: cancel active LemonSqueezy subs, delete all org data AND the user document',
      },
      args: {
        user: { type: 'string', description: "User's email; deletes them and every org they own" },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { deleteUser } = await import('../lib/db');

          emitter.warn('Applies to whatever MONGO_URI targets — never run this against prod.');
          emitter.step('db:delete-user', 'start');

          const result = await deleteUser({ user: args.user as string | undefined });
          emitter.step('db:delete-user', result.ok ? 'done' : 'fail');
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'reset-user': defineCommand({
      meta: {
        name: 'reset-user',
        description:
          "Delete a user's orgs and all org data so onboarding re-runs (dev/staging helper)",
      },
      args: {
        user: { type: 'string', description: "User's email; wipes every org they own" },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { resetUser } = await import('../lib/db');

          emitter.warn('Applies to whatever MONGO_URI targets — never run this against prod.');
          emitter.step('db:reset-user', 'start');

          const result = await resetUser({ user: args.user as string | undefined });
          emitter.step('db:reset-user', result.ok ? 'done' : 'fail');
          emitter.result(result);

          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
  },
});
