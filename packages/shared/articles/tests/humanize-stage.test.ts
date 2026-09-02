import type { LlmClient } from '@shared/providers';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { fleschKincaidGrade } = vi.hoisted(() => ({
  fleschKincaidGrade: vi.fn<(markdown: string) => number | null>(),
}));

vi.mock('@shared/generation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/generation')>()),
  fleschKincaidGrade,
}));

import { ArticleFatalError } from '../src/errors';
import { READABILITY_MAX_PASSES, stageHumanize } from '../src/stages/humanize';
import { makeRun, presets } from './fixtures';

/** content string -> grade, mirroring the deterministic fleschKincaidGrade mock. */
const gradeOf: Record<string, number | null> = {
  'rewrite-pass': 6,
  'rewrite-high-1': 12,
  'rewrite-high-2': 10,
  'rewrite-high-3': 11,
  'Acme draft text': 13,
  'stripped-pass': 6,
  'stripped-pass-2': 5,
  'stripped-pass-3': 4,
  'Acme rewrite-pass': 6,
  'Acme rewrite-high': 10,
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
    expect(messages[0]!.content).toContain('target of grade level 8');

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

  describe('brand preservation (#266)', () => {
    const brandDraft = { working: { draft: 'Acme draft text' } };

    test('a rewrite that passes the grade but strips the business name loops', async () => {
      const llm = llmReplying('stripped-pass');
      const run = makeRun(brandDraft);

      const result = await stageHumanize(run, llm);

      expect(result).toEqual({
        completed: false,
        working: { humanize_attempts: [{ attempt: 1, grade: 6, content: 'stripped-pass' }] },
        output: { readability_ok: false },
      });
    });

    test('retry after a brand-stripping attempt rewrites the draft with brand feedback', async () => {
      const priorAttempts = [{ attempt: 1, grade: 6, content: 'stripped-pass' }];
      const llm = llmReplying('Acme rewrite-pass');
      const run = makeRun({
        working: { draft: 'Acme draft text', humanize_attempts: priorAttempts },
      });

      const result = await stageHumanize(run, llm);

      const { messages } = vi.mocked(llm.complete).mock.calls[0]![0];
      expect(messages[1]).toEqual({ role: 'user', content: 'Acme draft text' });
      expect(messages[0]!.content).toContain('removed every mention of Acme');
      expect(messages[0]!.content).not.toContain('scored Flesch-Kincaid');

      expect(result).toEqual({
        completed: true,
        working: {
          content: 'Acme rewrite-pass',
          readability_grade: 6,
          humanize_attempts: [
            ...priorAttempts,
            { attempt: 2, grade: 6, content: 'Acme rewrite-pass' },
          ],
        },
        output: { readability_ok: true },
      });
    });

    test('at the cap, a brand-keeping attempt wins over lower-grade stripped ones', async () => {
      const priorAttempts = [
        { attempt: 1, grade: 10, content: 'Acme rewrite-high' },
        { attempt: 2, grade: 6, content: 'stripped-pass' },
      ];
      const llm = llmReplying('stripped-pass-2');
      const run = makeRun({
        working: { draft: 'Acme draft text', humanize_attempts: priorAttempts },
      });

      const result = await stageHumanize(run, llm);

      expect(result).toEqual({
        completed: true,
        working: {
          content: 'Acme rewrite-high',
          readability_grade: 10,
          humanize_attempts: [
            ...priorAttempts,
            { attempt: 3, grade: 5, content: 'stripped-pass-2' },
          ],
        },
        output: { readability_ok: true },
      });
    });

    test('at the cap with every attempt stripped, falls back to the draft', async () => {
      const priorAttempts = [
        { attempt: 1, grade: 6, content: 'stripped-pass' },
        { attempt: 2, grade: 5, content: 'stripped-pass-2' },
      ];
      const llm = llmReplying('stripped-pass-3');
      const run = makeRun({
        working: { draft: 'Acme draft text', humanize_attempts: priorAttempts },
      });

      const result = await stageHumanize(run, llm);

      expect(result).toEqual({
        completed: true,
        working: {
          content: 'Acme draft text',
          readability_grade: 13,
          humanize_attempts: [
            ...priorAttempts,
            { attempt: 3, grade: 4, content: 'stripped-pass-3' },
          ],
        },
        output: { readability_ok: true },
      });
    });

    test('a draft that never mentioned the business is not held to the brand check', async () => {
      const llm = llmReplying('rewrite-pass');
      const run = makeRun({ working: { draft: 'draft text' } });

      const result = await stageHumanize(run, llm);

      expect(result.completed).toBe(true);
      expect(result.working.content).toBe('rewrite-pass');
    });

    test('no CTA expected means no brand check', async () => {
      const noCta = structuredClone(presets);
      noCta.article_preferences.engagement.include_cta = false;
      const llm = llmReplying('stripped-pass');
      const run = makeRun({ working: { draft: 'Acme draft text' }, presets: noCta });

      const result = await stageHumanize(run, llm);

      expect(result.completed).toBe(true);
      expect(result.working.content).toBe('stripped-pass');
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

  test('a grade above 8 but at the org target passes in one pass (#313)', async () => {
    // gradeOf['rewrite-high-2'] is 10; the org allows 12.
    const llm = llmReplying('rewrite-high-2');
    const technical = {
      ...presets,
      article_preferences: {
        ...presets.article_preferences,
        content_seo: { ...presets.article_preferences.content_seo, readability_grade_max: 12 },
      },
    };
    const run = makeRun({ working: { draft: 'draft text' }, presets: technical });

    const result = await stageHumanize(run, llm);

    expect(result).toEqual({
      completed: true,
      working: {
        content: 'rewrite-high-2',
        readability_grade: 10,
        humanize_attempts: [{ attempt: 1, grade: 10, content: 'rewrite-high-2' }],
      },
      output: { readability_ok: true },
    });
  });

  test('retry feedback quotes the org target, not a global one (#313)', async () => {
    const technical = {
      ...presets,
      article_preferences: {
        ...presets.article_preferences,
        content_seo: { ...presets.article_preferences.content_seo, readability_grade_max: 10 },
      },
    };
    const priorAttempts = [{ attempt: 1, grade: 12, content: 'rewrite-high-1' }];
    const llm = llmReplying('rewrite-pass');
    const run = makeRun({
      working: { draft: 'draft text', humanize_attempts: priorAttempts },
      presets: technical,
    });

    await stageHumanize(run, llm);

    const { messages } = vi.mocked(llm.complete).mock.calls[0]![0];
    expect(messages[0]!.content).toContain('target of grade level 10');
    expect(messages[0]!.content).toContain('grade level 10 or lower');
  });
});
