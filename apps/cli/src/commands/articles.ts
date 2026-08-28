/**
 * `articles` command group — on-demand article pipeline operations (spec:
 * docs/superpowers/specs/2026-08-22-article-cli-design.md). Reads/writes
 * whatever MONGO_URI targets; generate-next launches an article-generation
 * run via @shared/articles (Step Functions when ARTICLE_STATE_MACHINE_ARN is
 * set, in-process otherwise); publish enqueues to whatever PUBLISH_QUEUE_URL
 * targets, and the deployed publish worker does the actual work.
 */
import { defineCommand } from 'citty';
import { EXIT, type ExitCode, type OutputMode, type Result, type WaitReport } from '../types';
import { createEmitter } from '../utils/emitter';
import { emitInternal, outputOption, verboseOption } from './shared';

const EXIT_BY_CODE: Record<string, ExitCode> = {
  AWS_NOT_AUTHENTICATED: EXIT.INFRA_DOWN,
  SQS_UNAVAILABLE: EXIT.INFRA_DOWN,
};

/**
 * A timed-out or failed `--wait` exits OP_FAILED even though the enqueue
 * itself succeeded — never claim success the pipeline didn't earn.
 */
function exitFor(result: Result<{ wait?: WaitReport | null }>): ExitCode {
  if (!result.ok) return EXIT_BY_CODE[result.error.code] ?? EXIT.USER_ERROR;
  const wait = result.data.wait;
  if (wait && (wait.timed_out || wait.outcomes.some((o) => !o.ok))) return EXIT.OP_FAILED;
  return EXIT.SUCCESS;
}

const targetArgs = {
  org: { type: 'string' as const, description: 'Org id (or use --user)' },
  user: { type: 'string' as const, description: 'User email owning the org (or use --org)' },
};

const waitArgs = (defaultTimeout: string) => ({
  wait: {
    type: 'boolean' as const,
    description: 'Poll until the pipeline reaches a terminal state',
    default: false,
  },
  timeout: {
    type: 'string' as const,
    description: `--wait timeout in seconds (default ${defaultTimeout})`,
    default: defaultTimeout,
  },
});

function parsePositiveInt(raw: string): number | null {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export const articlesCommand = defineCommand({
  meta: {
    name: 'articles',
    description: 'Article pipeline: inspect state, trigger generation, (re)publish',
  },
  subCommands: {
    list: defineCommand({
      meta: { name: 'list', description: "One row per article with the org's pipeline state" },
      args: {
        ...targetArgs,
        limit: { type: 'string' as const, description: 'Max rows (default 50)', default: '50' },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const limit = parsePositiveInt(args.limit as string);
          if (limit === null) {
            emitter.result({
              ok: false,
              error: { code: 'BAD_ARGS', message: '--limit must be a positive integer.' },
            });
            return process.exit(EXIT.USER_ERROR);
          }
          const { listArticles } = await import('../lib/articles');
          emitter.step('articles:list', 'start');
          const result = await listArticles({
            org: args.org as string | undefined,
            user: args.user as string | undefined,
            limit,
          });
          emitter.step('articles:list', result.ok ? 'done' : 'fail');
          emitter.result(result);
          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    show: defineCommand({
      meta: { name: 'show', description: 'Full pipeline detail for one article (pollable)' },
      args: {
        id: { type: 'positional' as const, description: 'Article id', required: true },
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const { showArticle } = await import('../lib/articles');
          emitter.step('articles:show', 'start');
          const result = await showArticle(args.id as string);
          emitter.step('articles:show', result.ok ? 'done' : 'fail');
          emitter.result(result);
          process.exit(result.ok ? EXIT.SUCCESS : EXIT.USER_ERROR);
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    'generate-next': defineCommand({
      meta: {
        name: 'generate-next',
        description:
          "Enqueue generation for the org's next ungenerated planner keyword(s) — the deployed pipeline (generate → images → publish) runs now instead of at the daily cron",
      },
      args: {
        ...targetArgs,
        count: {
          type: 'string' as const,
          description: 'Keywords to enqueue (default 1)',
          default: '1',
        },
        ...waitArgs('900'),
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const count = parsePositiveInt(args.count as string);
          const timeout = parsePositiveInt(args.timeout as string);
          if (count === null || timeout === null) {
            emitter.result({
              ok: false,
              error: {
                code: 'BAD_ARGS',
                message: '--count and --timeout must be positive integers.',
              },
            });
            return process.exit(EXIT.USER_ERROR);
          }
          const { generateNext } = await import('../lib/articles');
          emitter.warn(
            'Launches REAL generation work (LLM + image credits) for the org in whatever MONGO_URI targets.',
          );
          emitter.step('articles:generate-next', 'start');
          const result = await generateNext({
            org: args.org as string | undefined,
            user: args.user as string | undefined,
            count,
            wait: args.wait as boolean,
            timeoutMs: timeout * 1000,
          });
          emitter.step('articles:generate-next', result.ok ? 'done' : 'fail');
          if (result.ok && result.data.wait?.timed_out) {
            emitter.warn(
              `--wait timed out after ${timeout}s — the pipeline may still be running; poll with \`articles show\`.`,
            );
          }
          emitter.result(result);
          process.exit(exitFor(result));
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
    publish: defineCommand({
      meta: {
        name: 'publish',
        description:
          'Reset failed auto-publish attempts and enqueue publishing for an existing article (worker gates are checked up front)',
      },
      args: {
        id: { type: 'positional' as const, description: 'Article id', required: true },
        provider: {
          type: 'string' as const,
          description: 'Only this provider: wordpress or static-site (default: all connected)',
        },
        ...waitArgs('360'),
        ...outputOption,
        ...verboseOption,
      },
      async run({ args }) {
        const emitter = createEmitter(args.output as OutputMode);
        try {
          const timeout = parsePositiveInt(args.timeout as string);
          if (timeout === null) {
            emitter.result({
              ok: false,
              error: { code: 'BAD_ARGS', message: '--timeout must be a positive integer.' },
            });
            return process.exit(EXIT.USER_ERROR);
          }
          const { publishArticle } = await import('../lib/articles');
          emitter.warn(
            'Publishes to the LIVE destination connected for this org (WordPress site / GitHub repo), via whatever PUBLISH_QUEUE_URL and MONGO_URI target.',
          );
          emitter.step('articles:publish', 'start');
          const result = await publishArticle({
            articleId: args.id as string,
            provider: args.provider as string | undefined,
            wait: args.wait as boolean,
            timeoutMs: timeout * 1000,
          });
          emitter.step('articles:publish', result.ok ? 'done' : 'fail');
          if (result.ok && result.data.wait?.timed_out) {
            emitter.warn(
              `--wait timed out after ${timeout}s — the publish worker may still hold the task; poll with \`articles show\`.`,
            );
          }
          emitter.result(result);
          process.exit(exitFor(result));
        } catch (e) {
          return emitInternal(emitter, e);
        }
      },
    }),
  },
});
