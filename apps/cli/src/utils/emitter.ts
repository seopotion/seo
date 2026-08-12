/**
 * Output emitter — abstracts text (human) vs json (agent) rendering.
 *
 * text: progress to stderr, final result pretty-printed to stdout.
 * json: JSONL progress events to stderr, single final JSON object to stdout.
 */
import type { Emitter, OutputMode } from '../types';

export function createEmitter(mode: OutputMode): Emitter {
  return mode === 'json' ? createJsonEmitter() : createTextEmitter();
}

function createTextEmitter(): Emitter {
  return {
    step(name, status, detail) {
      const icon = status === 'start' ? '▶' : status === 'done' ? '✓' : '✗';
      process.stderr.write(`${detail ? `${icon} ${name}: ${detail}` : `${icon} ${name}`}\n`);
    },
    info(message) {
      process.stderr.write(`  ${message}\n`);
    },
    warn(message) {
      process.stderr.write(`⚠ ${message}\n`);
    },
    error(message) {
      process.stderr.write(`✗ ${message}\n`);
    },
    result(data) {
      if (!data.ok) {
        process.stderr.write(`\nError [${data.error.code}]: ${data.error.message}\n`);
        if (data.error.suggestion) {
          process.stderr.write(`  Suggestion: ${data.error.suggestion}\n`);
        }
      } else {
        process.stdout.write(`${JSON.stringify(data.data, null, 2)}\n`);
      }
    },
  };
}

/**
 * `npm run` prints its `> pkg@ver script` banner to STDOUT before this process
 * even starts, so `--output json` piped into a parser trips over the preamble.
 * It cannot be unprinted from here — `npm run --silent` is the only cure — so
 * say so on stderr, where it cannot corrupt the payload, rather than leave a
 * mystery parse error (#211).
 */
function warnIfNpmPreamble(): void {
  if (!process.env.npm_lifecycle_event) return;
  if (process.env.npm_config_loglevel === 'silent') return;
  process.stderr.write(
    'warning: npm printed its script banner to stdout ahead of this JSON. ' +
      'Re-run as `npm run --silent cli -- …` for parseable output.\n',
  );
}

function createJsonEmitter(): Emitter {
  warnIfNpmPreamble();
  const jsonLine = (obj: Record<string, unknown>) => {
    process.stderr.write(`${JSON.stringify(obj)}\n`);
  };
  return {
    step(name, status, detail) {
      jsonLine({ type: `step:${status}`, step: name, ...(detail ? { detail } : {}) });
    },
    info(message) {
      jsonLine({ type: 'info', message });
    },
    warn(message) {
      jsonLine({ type: 'warn', message });
    },
    error(message) {
      jsonLine({ type: 'error', message });
    },
    result(data) {
      if (data.ok) {
        process.stdout.write(`${JSON.stringify(data.data)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify({ error: data.error })}\n`);
      }
    },
  };
}
