import { buildOutlinePrompt, OUTLINE_RESPONSE_SCHEMA, parseOutline } from '@shared/generation';
import type { LlmClient } from '@shared/providers';
import type { ArticleRun } from '@shared/schemas';
import { contextFromRun } from '../context';
import type { StageOutcome } from './types';

export async function stageOutline(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const ctx = contextFromRun(run);
  const res = await llm.complete({
    messages: buildOutlinePrompt(ctx),
    responseSchema: OUTLINE_RESPONSE_SCHEMA,
  });
  const outline = parseOutline(res.text, ctx);
  return { completed: true, working: { outline } };
}
