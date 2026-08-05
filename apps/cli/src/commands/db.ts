/**
 * db command — database management.
 */
import { defineCommand } from 'citty';
import { EXIT, type OutputMode } from '../types';
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

          emitter.warn('Applies to whatever MONGODB_URI targets — never run this against prod.');
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
              ? "Writes to whatever MONGODB_URI targets — safe and intended for prod. Republish every published article it changes, or the customer's site keeps the dead links."
              : 'Dry run against whatever MONGODB_URI targets — nothing is written. Safe and intended for prod; pass --apply to write.',
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

          emitter.warn('Applies to whatever MONGODB_URI targets — never run this against prod.');
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

          emitter.warn('Applies to whatever MONGODB_URI targets — never run this against prod.');
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
