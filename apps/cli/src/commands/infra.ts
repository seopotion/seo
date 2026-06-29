/**
 * infra command — local infrastructure health checks.
 */
import { defineCommand } from 'citty';
import { EXIT, fail, type InfraService, type OutputMode } from '../types';
import { createEmitter } from '../utils/emitter';
import { outputOption, verboseOption } from './shared';

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
        } else {
          emitter.result(result);
        }

        process.exit(result.ok && result.data.allHealthy ? EXIT.SUCCESS : EXIT.INFRA_DOWN);
      },
    }),
  },
});
