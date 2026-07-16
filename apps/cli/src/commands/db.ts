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
        plan: { type: 'string', description: 'free | trial | paid', default: 'paid' },
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
