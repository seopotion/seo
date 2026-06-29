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
  },
});
