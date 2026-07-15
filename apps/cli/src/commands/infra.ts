/**
 * infra command — local infrastructure health checks.
 */
import { defineCommand } from 'citty';
import { EXIT, fail, type InfraService, type OutputMode, type Stage } from '../types';
import { createEmitter } from '../utils/emitter';
import { emitInternal, outputOption, verboseOption } from './shared';

export const infraCommand = defineCommand({
  meta: { name: 'infra', description: 'Infrastructure management' },
  subCommands: {
    check: defineCommand({
      meta: { name: 'check', description: 'Check infrastructure health (mongo, sqs, api)' },
      args: {
        ...outputOption,
        ...verboseOption,
        services: {
          type: 'string',
          description: 'Comma-separated services to check: mongo,sqs,api',
        },
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { VALID_SERVICES, checkInfra } = await import('../lib/infra');

          let services: InfraService[] | undefined;
          if (args.services) {
            const requested = (args.services as string).split(',').map((s) => s.trim());
            const invalid = requested.filter((s) => !VALID_SERVICES.includes(s as InfraService));
            if (invalid.length > 0) {
              emitter.result(
                fail(
                  'INVALID_SERVICE',
                  `Unknown service(s): ${invalid.join(', ')}`,
                  `Valid: ${VALID_SERVICES.join(', ')}`,
                ),
              );
              return process.exit(EXIT.USER_ERROR);
            }
            services = requested as InfraService[];
          }

          if (args.verbose) {
            emitter.info(`Checking: ${(services ?? VALID_SERVICES).join(', ')}`);
          }

          const result = await checkInfra(services);

          if (args.output !== 'json' && result.ok) {
            for (const svc of result.data.services) {
              const icon = svc.available ? '✓' : '✗';
              const latency = svc.latencyMs !== undefined ? ` (${svc.latencyMs}ms)` : '';
              const error = svc.error ? ` — ${svc.error}` : '';
              emitter.info(
                `${icon} ${svc.service.padEnd(6)}${svc.available ? 'up' : 'down'}${latency}${error}`,
              );
            }
            emitter.info('');
            emitter.info(
              result.data.allHealthy ? 'All services healthy' : 'Some services unavailable',
            );
          }

          emitter.result(result);

          process.exit(result.ok && result.data.allHealthy ? EXIT.SUCCESS : EXIT.INFRA_DOWN);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    preflight: defineCommand({
      meta: {
        name: 'preflight',
        description:
          'Verify per-stage deploy prerequisites (SSM secrets, GOOGLE_CLIENT_ID, WEB_ORIGIN)',
      },
      args: {
        ...outputOption,
        ...verboseOption,
        stage: {
          type: 'string',
          description: 'Environment to check: staging or prod',
          required: true,
        },
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { STAGES, preflight } = await import('../lib/preflight');

          const stage = args.stage as string;
          if (!STAGES.includes(stage as Stage)) {
            emitter.result(
              fail('INVALID_STAGE', `Unknown stage: ${stage}`, `Valid: ${STAGES.join(', ')}`),
            );
            return process.exit(EXIT.USER_ERROR);
          }

          const result = await preflight(stage as Stage);

          if (args.output !== 'json' && result.ok) {
            for (const check of result.data.checks) {
              const icon = check.present ? '✓' : '✗';
              const error = check.error ? ` — ${check.error}` : '';
              emitter.info(`${icon} ${check.kind.padEnd(3)} ${check.name}${error}`);
            }
            emitter.info('');
            emitter.info(
              result.data.ready
                ? `All ${stage} prerequisites present`
                : `Missing ${stage} prerequisites — do not deploy`,
            );
          }

          emitter.result(result);

          process.exit(result.ok && result.data.ready ? EXIT.SUCCESS : EXIT.INFRA_DOWN);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
  },
});
