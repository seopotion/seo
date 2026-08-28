import type { GenerationContext } from '@shared/generation';
import { buildContext } from '@shared/generation';
import type { ArticleRun } from '@shared/schemas';

/** Rebuild the generation context from the run's launch snapshot. */
export function contextFromRun(run: ArticleRun): GenerationContext {
  return buildContext(
    { presets: run.input.presets },
    run.input.keyword,
    run.working.link_candidates,
  );
}
