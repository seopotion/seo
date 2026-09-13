import { buildOutlinePrompt, OUTLINE_RESPONSE_SCHEMA, parseOutline } from '@shared/generation';
import { type LlmClient, routeLlm } from '@shared/providers';
import type { ArticleRun } from '@shared/schemas';
import { contextFromRun } from '../context';
import { logLlmUsage } from '../llm-usage';
import type { StageOutcome } from './types';

export async function stageOutline(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const ctx = contextFromRun(run);
  const res = await llm.complete({
    messages: buildOutlinePrompt(ctx),
    responseSchema: OUTLINE_RESPONSE_SCHEMA,
    ...routeLlm(ctx.contentComplexity, 'outline'),
  });
  logLlmUsage('outline', res);
  const outline = parseOutline(res.text, ctx);
  return { completed: true, working: { outline } };
}
