import { buildArticlePrompt } from '@shared/generation';
import type { LlmClient } from '@shared/providers';
import type { ArticleRun } from '@shared/schemas';
import { contextFromRun } from '../context';
import { ArticleFatalError } from '../errors';
import type { StageOutcome } from './types';

export async function stageDraft(run: ArticleRun, llm: LlmClient): Promise<StageOutcome> {
  const outline = run.working.outline;
  if (!outline) throw new ArticleFatalError('draft stage requires a checkpointed outline');
  const ctx = contextFromRun(run);
  const res = await llm.complete({ messages: buildArticlePrompt(ctx, outline) });
  return { completed: true, working: { draft: res.text } };
}
