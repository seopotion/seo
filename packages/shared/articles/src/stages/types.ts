import type { ArticleRunWorking } from '@shared/schemas';

export interface StageOutcome {
  working: Partial<ArticleRunWorking>;
  /** false only for a humanize attempt that must loop. */
  completed: boolean;
  output?: { readability_ok: boolean };
}
