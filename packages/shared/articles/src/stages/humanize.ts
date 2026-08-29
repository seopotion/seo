import {
  buildHumanizePrompt,
  FLESCH_KINCAID_TARGET,
  fleschKincaidGrade,
  HUMANIZE,
} from '@shared/generation';
import type { LlmClient } from '@shared/providers';
import type { ArticleRun, HumanizeAttempt } from '@shared/schemas';
import { contextFromRun } from '../context';
import { ArticleFatalError } from '../errors';
import type { StageOutcome } from './types';

/** Initial humanize pass + up to 2 readability retries (2026-08-28 spec). */
export const READABILITY_MAX_PASSES = 3;

const passes = (grade: number | null) => grade === null || grade <= FLESCH_KINCAID_TARGET;

/** Lowest measured grade wins; a passing (null) grade would have exited earlier. */
function bestAttempt(attempts: HumanizeAttempt[]): HumanizeAttempt {
  return attempts.reduce((best, a) =>
    (a.grade ?? Number.NEGATIVE_INFINITY) < (best.grade ?? Number.NEGATIVE_INFINITY) ? a : best,
  );
}

export async function stageHumanize(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const draft = run.working.draft;
  if (draft === null) throw new ArticleFatalError('humanize stage requires a checkpointed draft');
  const ctx = contextFromRun(run);

  if (!HUMANIZE) {
    return {
      completed: true,
      working: { content: draft, readability_grade: null, humanize_attempts: [] },
      output: { readability_ok: true },
    };
  }

  const prior = run.working.humanize_attempts;
  const previous = prior.at(-1);
  const input = previous?.content ?? draft;
  const feedback =
    previous && previous.grade !== null
      ? { attempt: previous.attempt, grade: previous.grade, target: FLESCH_KINCAID_TARGET }
      : undefined;

  const res = await llm.complete({ messages: buildHumanizePrompt(ctx, input, feedback) });
  const grade = ctx.language === 'English' ? fleschKincaidGrade(res.text) : null;
  const attempt: HumanizeAttempt = { attempt: prior.length + 1, grade, content: res.text };
  const attempts = [...prior, attempt];

  if (passes(grade)) {
    return {
      completed: true,
      working: { content: attempt.content, readability_grade: grade, humanize_attempts: attempts },
      output: { readability_ok: true },
    };
  }
  if (attempts.length >= READABILITY_MAX_PASSES) {
    const best = bestAttempt(attempts);
    return {
      completed: true,
      working: {
        content: best.content,
        readability_grade: best.grade,
        humanize_attempts: attempts,
      },
      output: { readability_ok: true }, // proceed anyway (spec: cap behavior)
    };
  }
  return {
    completed: false,
    working: { humanize_attempts: attempts },
    output: { readability_ok: false },
  };
}
