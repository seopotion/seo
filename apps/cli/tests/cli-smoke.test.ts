import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

// Repo root: vitest runs with cwd at the workspace root.
const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');
const entry = resolve(process.cwd(), 'apps/cli/src/index.ts');

function run(args: string[]) {
  // consola (used by citty) silences output when NODE_ENV=test or TEST=true.
  // Override to non-test so the child process is treated as a real CLI invocation.
  const r = spawnSync(tsx, [entry, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'development', TEST: '' },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe('cli smoke', () => {
  test('--help exits 0 and lists both command groups', () => {
    const { status, out } = run(['--help']);
    expect(status).toBe(0);
    expect(out).toContain('infra');
    expect(out).toContain('db');
  });
});
