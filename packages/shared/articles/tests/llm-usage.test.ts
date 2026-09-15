import { afterEach, expect, test, vi } from 'vitest';
import { logLlmUsage } from '../src/llm-usage';

afterEach(() => vi.restoreAllMocks());

// The staging check reads this line to confirm which model a stage ran on;
// the run document records nothing about models (design/ai-model-routing.md).
test('logs stage, served model and provider, and measured usage on one info line', () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});

  logLlmUsage('draft', {
    text: 'x',
    model: 'qwen/qwen3.8-max-0902',
    provider: 'Alibaba',
    usage: { promptTokens: 10, completionTokens: 20, totalTokens: 30, costUsd: 0.5 },
  });

  expect(info).toHaveBeenCalledWith('llm usage', {
    stage: 'draft',
    model: 'qwen/qwen3.8-max-0902',
    provider: 'Alibaba',
    prompt_tokens: 10,
    completion_tokens: 20,
    cost_usd: 0.5,
  });
});
