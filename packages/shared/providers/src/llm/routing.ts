import type { ContentComplexity } from '@shared/schemas';

/** The article stages that call the LLM. The keyword pipeline pins its own models. */
export type LlmTask = 'outline' | 'draft' | 'humanize' | 'finalize' | 'image_plan';
export const LLM_TASKS: readonly LlmTask[] = [
  'outline',
  'draft',
  'humanize',
  'finalize',
  'image_plan',
];

export interface LlmRoute {
  /** OpenRouter model id. */
  model: string;
  /** Per-request timeout for this model; bigger models need longer. */
  timeoutMs: number;
}

/** The client default: what every call got before routing existed. */
export const DEFAULT_LLM_MODEL = 'anthropic/claude-haiku-4.5';
export const DEFAULT_LLM_TIMEOUT_MS = 60_000;

const HAIKU: LlmRoute = { model: DEFAULT_LLM_MODEL, timeoutMs: DEFAULT_LLM_TIMEOUT_MS };
const SONNET: LlmRoute = { model: 'anthropic/claude-sonnet-5', timeoutMs: 120_000 };
const OPUS: LlmRoute = { model: 'anthropic/claude-opus-5', timeoutMs: 240_000 };

/**
 * Per-stage ladder by the org's content_complexity (design/ai-model-routing.md).
 * The draft is where technical accuracy lives, so it gets the largest jump;
 * humanize on a technical draft risks dumbing it down, so it gets a stronger
 * model at the top tier but never Opus; meta, semantic markup and image
 * planning are mechanical regardless of audience. `general` is the client
 * default everywhere, so unrouted orgs are byte-identical to before.
 */
const LADDER: Record<LlmTask, Record<ContentComplexity, LlmRoute>> = {
  outline: { general: HAIKU, professional: SONNET, technical: SONNET },
  draft: { general: HAIKU, professional: SONNET, technical: OPUS },
  humanize: { general: HAIKU, professional: HAIKU, technical: SONNET },
  finalize: { general: HAIKU, professional: HAIKU, technical: HAIKU },
  image_plan: { general: HAIKU, professional: HAIKU, technical: HAIKU },
};

export function routeLlm(complexity: ContentComplexity, task: LlmTask): LlmRoute {
  return LADDER[task][complexity];
}
