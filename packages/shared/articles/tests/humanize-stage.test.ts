import type { LlmClient } from '@shared/providers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { fleschKincaidGrade } = vi.hoisted(() => ({
  fleschKincaidGrade: vi.fn<(markdown: string) => number | null>(),
}));

vi.mock('@shared/generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/generation')>()),
  fleschKincaidGrade,
}));

import { FLESCH_KINCAID_TARGET } from '@shared/generation';
import { ArticleFatalError } from '../src/errors';
import { READABILITY_MAX_PASSES, stageHumanize } from '../src/stages/humanize';
import { makeRun, presets } from './fixtures';

/** content string -> grade, mirroring the deterministic fleschKincaidGrade mock. */
const gradeOf: Record<string, number | null> = {
  'rewrite-pass': 6,
  'rewrite-high-1': 12,
  'rewrite-high-2': 10,
  'rewrite-high-3': 11,
};

function llmReplying(...texts: string[]): LlmClient {
  const complete = vi.fn();
  for (const text of texts) {
    complete.mockResolvedValueOnce({
      text,
      model: 'test',
      usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2, costUsd: 0.01 },
    });
  }
  return { complete };
}

beforeEach(() => {
  vi.clearAllMocks();
  fleschKincaidGrade.mockImplementation((text: string) => gradeOf[text] ?? null);
});

describe('stageHumanize', () => {
  test('throws ArticleFatalError when working.draft is null', async () => {
    const llm = llmReplying('unused');
    await expect(stageHumanize(makeRun(), llm)).rejects.toThrow(ArticleFatalError);
    expect(llm.complete).not.toHaveBeenCalled();
  });

  test('English draft at or below target grade completes on the first pass', async () => {
    const llm = llmReplying('rewrite-pass');
    const run = makeRun({ working: { draft: 'draft text' } });

    const result = await stageHumanize(run, llm);

    expect(result).toEqual({
      completed: true,
      working: {
        content: 'rewrite-pass',
        readability_grade: 6,
        humanize_attempts: [{ attempt: 1, grade: 6, content: 'rewrite-pass' }],
      },
      output: { readability_ok: true },
    });
  });

  test('unmeasurable grade (null) on an English draft is treated as passing', async () => {
    const llm = llmReplying('rewrite-unmeasurable');
    const run = makeRun({ working: { draft: 'draft text' } });

    const result = await stageHumanize(run, llm);

    expect(result).toEqual({
      completed: true,
      working: {
        content: 'rewrite-unmeasurable',
        readability_grade: null,
        humanize_attempts: [{ attempt: 1, grade: null, content: 'rewrite-unmeasurable' }],
      },
      output: { readability_ok: true },
    });
  });

  test('English draft above target grade with attempts remaining loops (not completed)', async () => {
    const llm = llmReplying('rewrite-high-1');
    const run = makeRun({ working: { draft: 'draft text' } });

    const result = await stageHumanize(run, llm);

    expect(result).toEqual({
      completed: false,
      working: { humanize_attempts: [{ attempt: 1, grade: 12, content: 'rewrite-high-1' }] },
      output: { readability_ok: false },
    });
  });

  test('retry rewrites the previous attempt content (not the original draft) with feedback', async () => {
    const priorAttempts = [{ attempt: 1, grade: 12, content: 'rewrite-high-1' }];
    const llm = llmReplying('rewrite-pass');
    const run = makeRun({ working: { draft: 'draft text', humanize_attempts: priorAttempts } });

    const result = await stageHumanize(run, llm);

    expect(llm.complete).toHaveBeenCalledTimes(1);
    const { messages } = vi.mocked(llm.complete).mock.calls[0]![0];
    expect(messages[1]).toEqual({ role: 'user', content: 'rewrite-high-1' });
    expect(messages[0]!.content).toContain('attempt 1');
    expect(messages[0]!.content).toContain('grade level 12');
    expect(messages[0]!.content).toContain(`grade level ${FLESCH_KINCAID_TARGET}`);

    expect(result).toEqual({
      completed: true,
      working: {
        content: 'rewrite-pass',
        readability_grade: 6,
        humanize_attempts: [...priorAttempts, { attempt: 2, grade: 6, content: 'rewrite-pass' }],
      },
      output: { readability_ok: true },
    });
  });

  test('caps at READABILITY_MAX_PASSES attempts and picks the lowest-grade attempt', async () => {
    expect(READABILITY_MAX_PASSES).toBe(3);
    const priorAttempts = [
      { attempt: 1, grade: 14, content: 'rewrite-high-1' },
      { attempt: 2, grade: 10, content: 'rewrite-high-2' },
    ];
    const llm = llmReplying('rewrite-high-3');
    const run = makeRun({ working: { draft: 'draft text', humanize_attempts: priorAttempts } });

    const result = await stageHumanize(run, llm);

    expect(result).toEqual({
      completed: true,
      working: {
        content: 'rewrite-high-2',
        readability_grade: 10,
        humanize_attempts: [...priorAttempts, { attempt: 3, grade: 11, content: 'rewrite-high-3' }],
      },
      output: { readability_ok: true },
    });
  });

  test('non-English run completes after one pass without measuring grade', async () => {
    const llm = llmReplying('rewrite-non-english');
    const frenchPresets = { ...presets, business: { ...presets.business, language: 'French' } };
    const run = makeRun({ working: { draft: 'draft text' }, presets: frenchPresets });

    const result = await stageHumanize(run, llm);

    expect(fleschKincaidGrade).not.toHaveBeenCalled();
    expect(result).toEqual({
      completed: true,
      working: {
        content: 'rewrite-non-english',
        readability_grade: null,
        humanize_attempts: [{ attempt: 1, grade: null, content: 'rewrite-non-english' }],
      },
      output: { readability_ok: true },
    });
  });
});
