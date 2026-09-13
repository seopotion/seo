import type { LlmResult } from '@shared/providers';

/**
 * One info line per LLM call, keyed by stage. The run document records nothing
 * about models, so this is how a staging check (or a cost question) learns
 * which model actually served a stage and what it cost.
 */
export function logLlmUsage(stage: string, result: LlmResult): void {
  console.info('llm usage', {
    stage,
    model: result.model,
    prompt_tokens: result.usage.promptTokens,
    completion_tokens: result.usage.completionTokens,
    cost_usd: result.usage.costUsd,
  });
}
