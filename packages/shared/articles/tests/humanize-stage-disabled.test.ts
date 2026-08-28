import type { LlmClient } from '@shared/providers';
import { describe, expect, test, vi } from 'vitest';

// HUMANIZE is a const import, so it must be overridden at module-mock time, in
// its own test file (a per-test override wouldn't affect stageHumanize's
// already-bound import).
vi.mock('@shared/generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/generation')>()),
  HUMANIZE: false,
}));

import { stageHumanize } from '../src/stages/humanize';
import { makeRun } from './fixtures';

describe('stageHumanize with HUMANIZE disabled', () => {
  test('returns the draft verbatim without calling the llm', async () => {
    const complete = vi.fn();
    const llm: LlmClient = { complete };
    const run = makeRun({ working: { draft: 'draft verbatim text' } });

    const result = await stageHumanize(run, llm);

    expect(complete).not.toHaveBeenCalled();
    expect(result).toEqual({
      completed: true,
      working: { content: 'draft verbatim text', readability_grade: null, humanize_attempts: [] },
      output: { readability_ok: true },
    });
  });
});
