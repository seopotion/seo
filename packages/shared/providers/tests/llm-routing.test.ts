import { CONTENT_COMPLEXITIES } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import { DEFAULT_LLM_MODEL, DEFAULT_LLM_TIMEOUT_MS, LLM_TASKS, routeLlm } from '../src/llm/routing';

describe('routeLlm', () => {
  test('every cell resolves to a model and a positive timeout', () => {
    for (const complexity of CONTENT_COMPLEXITIES) {
      for (const task of LLM_TASKS) {
        const route = routeLlm(complexity, task);
        expect(route.model.length).toBeGreaterThan(0);
        expect(route.timeoutMs).toBeGreaterThan(0);
      }
    }
  });

  // `general` is today's behaviour — orgs that are not marked professional or
  // technical must see no change in model or cost (design/ai-model-routing.md).
  test('general is the client default everywhere', () => {
    for (const task of LLM_TASKS) {
      expect(routeLlm('general', task)).toEqual({
        model: DEFAULT_LLM_MODEL,
        timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      });
    }
    expect(DEFAULT_LLM_MODEL).toBe('anthropic/claude-haiku-4.5');
    expect(DEFAULT_LLM_TIMEOUT_MS).toBe(60_000);
  });

  test('the approved ladder', () => {
    const sonnet = 'anthropic/claude-sonnet-5';
    const opus = 'anthropic/claude-opus-5';
    expect(routeLlm('professional', 'outline').model).toBe(sonnet);
    expect(routeLlm('professional', 'draft').model).toBe(sonnet);
    expect(routeLlm('professional', 'humanize').model).toBe(DEFAULT_LLM_MODEL);
    expect(routeLlm('professional', 'finalize').model).toBe(DEFAULT_LLM_MODEL);
    expect(routeLlm('professional', 'image_plan').model).toBe(DEFAULT_LLM_MODEL);
    expect(routeLlm('technical', 'outline').model).toBe(sonnet);
    expect(routeLlm('technical', 'draft').model).toBe(opus);
    expect(routeLlm('technical', 'humanize').model).toBe(sonnet);
    expect(routeLlm('technical', 'finalize').model).toBe(DEFAULT_LLM_MODEL);
    expect(routeLlm('technical', 'image_plan').model).toBe(DEFAULT_LLM_MODEL);
  });

  // The client default is 60s; an Opus draft of ~5k tokens runs past it.
  test('bigger models get longer timeouts', () => {
    expect(routeLlm('professional', 'draft').timeoutMs).toBe(120_000);
    expect(routeLlm('technical', 'draft').timeoutMs).toBe(240_000);
  });
});
