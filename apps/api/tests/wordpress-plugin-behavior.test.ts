import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('WordPress idempotent publishing behavior', () => {
  test('serializes live connections and recovers work abandoned by a dead connection', () => {
    const root = process.cwd();
    const output = execFileSync(
      'php',
      [
        join(root, 'apps/api/tests/fixtures/wordpress-idempotency-harness.php'),
        join(root, 'apps/integration-clients/wordpress-org/libs/api.php'),
      ],
      { encoding: 'utf8' },
    );

    expect(JSON.parse(output)).toEqual({ passed: true });
  });
});
