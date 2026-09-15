import type { ContentComplexity } from '@shared/schemas';

/** The article stages that call the LLM. The keyword pipeline pins its own models. */
export const LLM_TASKS = ['outline', 'draft', 'humanize', 'finalize', 'image_plan'] as const;
export type LlmTask = (typeof LLM_TASKS)[number];

export interface LlmRoute {
  /** OpenRouter model id. */
  model: string;
  /**
   * OpenRouter provider slug the call is pinned to, with fallbacks disabled:
   * the price is the reason these models were chosen, and OpenRouter would
   * otherwise silently reroute to a pricier host of the same model.
   */
  provider: string;
  /** Per-request timeout for this model; bigger models need longer. */
  timeoutMs: number;
  /**
   * OpenRouter `reasoning.effort`; omitted = the model's own default. DeepSeek
   * defaults to `high` and Qwen to `xhigh` (mandatory), which on staging spent
   * 5.7k hidden tokens on a 350-token outline and ran the call to its timeout.
   */
  reasoningEffort?: LlmReasoningEffort;
}

export type LlmReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

/** The client default: what every unrouted call (scanner, strategy) gets. */
export const DEFAULT_LLM_MODEL = 'google/gemini-2.5-flash';
export const DEFAULT_LLM_PROVIDER = 'google-vertex/global';
export const DEFAULT_LLM_TIMEOUT_MS = 60_000;

const SMALL: LlmRoute = {
  model: DEFAULT_LLM_MODEL,
  provider: DEFAULT_LLM_PROVIDER,
  timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
};
const MEDIUM: LlmRoute = {
  model: 'deepseek/deepseek-v4-pro-0813',
  provider: 'alibaba',
  timeoutMs: 180_000,
  reasoningEffort: 'low',
};
const LARGE: LlmRoute = {
  model: 'qwen/qwen3.8-max-0902',
  provider: 'alibaba',
  timeoutMs: 300_000,
  reasoningEffort: 'low',
};

/**
 * Per-stage ladder by the org's content_complexity (design/ai-model-routing.md).
 * The draft is where technical accuracy lives, so it gets the largest jump;
 * humanize on a technical draft risks dumbing it down, so it gets a stronger
 * model at the top tier but never the largest; meta, semantic markup and image
 * planning are mechanical regardless of audience. `general` is the client
 * default everywhere, so unrouted orgs behave exactly like a general org.
 */
const LADDER: Record<LlmTask, Record<ContentComplexity, LlmRoute>> = {
  outline: { general: SMALL, professional: MEDIUM, technical: MEDIUM },
  draft: { general: SMALL, professional: MEDIUM, technical: LARGE },
  humanize: { general: SMALL, professional: SMALL, technical: MEDIUM },
  finalize: { general: SMALL, professional: SMALL, technical: SMALL },
  image_plan: { general: SMALL, professional: SMALL, technical: SMALL },
};

export function routeLlm(complexity: ContentComplexity, task: LlmTask): LlmRoute {
  return LADDER[task][complexity];
}
