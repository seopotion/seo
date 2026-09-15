import { CONTENT_COMPLEXITIES } from '@shared/schemas';
import { describe, expect, test } from 'vitest';
import {
  DEFAULT_LLM_MODEL,
  DEFAULT_LLM_PROVIDER,
  DEFAULT_LLM_TIMEOUT_MS,
  LLM_TASKS,
  routeLlm,
} from '../src/llm/routing';

describe('routeLlm', () => {
  test('every cell resolves to a model, a provider pin and a positive timeout', () => {
    for (const complexity of CONTENT_COMPLEXITIES) {
      for (const task of LLM_TASKS) {
        const route = routeLlm(complexity, task);
        expect(route.model.length).toBeGreaterThan(0);
        expect(route.provider.length).toBeGreaterThan(0);
        expect(route.timeoutMs).toBeGreaterThan(0);
      }
    }
  });

  // `general` is what every unrouted call (scanner, strategy) gets, so orgs
  // that are not marked professional or technical cost exactly the default.
  test('general is the client default everywhere', () => {
    for (const task of LLM_TASKS) {
      expect(routeLlm('general', task)).toEqual({
        model: DEFAULT_LLM_MODEL,
        provider: DEFAULT_LLM_PROVIDER,
        timeoutMs: DEFAULT_LLM_TIMEOUT_MS,
      });
    }
    expect(DEFAULT_LLM_MODEL).toBe('google/gemini-2.5-flash');
    expect(DEFAULT_LLM_PROVIDER).toBe('google-vertex/global');
    expect(DEFAULT_LLM_TIMEOUT_MS).toBe(60_000);
  });

  // Model ids and provider tags verified against the OpenRouter endpoints API
  // on 2026-09-14; all three serve strict structured outputs.
  test('the approved ladder', () => {
    const medium = { model: 'deepseek/deepseek-v4-pro-0813', provider: 'alibaba' };
    const large = { model: 'qwen/qwen3.8-max-0902', provider: 'alibaba' };
    const small = { model: DEFAULT_LLM_MODEL, provider: DEFAULT_LLM_PROVIDER };
    const pick = (c: 'professional' | 'technical', t: (typeof LLM_TASKS)[number]) => {
      const { model, provider } = routeLlm(c, t);
      return { model, provider };
    };
    expect(pick('professional', 'outline')).toEqual(medium);
    expect(pick('professional', 'draft')).toEqual(medium);
    expect(pick('professional', 'humanize')).toEqual(small);
    expect(pick('professional', 'finalize')).toEqual(small);
    expect(pick('professional', 'image_plan')).toEqual(small);
    expect(pick('technical', 'outline')).toEqual(medium);
    expect(pick('technical', 'draft')).toEqual(large);
    expect(pick('technical', 'humanize')).toEqual(medium);
    expect(pick('technical', 'finalize')).toEqual(small);
    expect(pick('technical', 'image_plan')).toEqual(small);
  });

  // The client default is 60s; a long technical draft runs past it. Measured
  // 2026-09-15 on staging at default reasoning effort: outline 120 s, draft
  // 201 s — so the limits carry headroom over the low-effort durations.
  test('bigger models get longer timeouts', () => {
    expect(routeLlm('professional', 'draft').timeoutMs).toBe(180_000);
    expect(routeLlm('technical', 'draft').timeoutMs).toBe(300_000);
  });

  // DeepSeek defaults to effort `high` and Qwen to `xhigh` (mandatory): a
  // 350-token outline cost 5.7k completion tokens of hidden reasoning.
  test('medium and large routes cap reasoning effort at low; small leaves the default', () => {
    expect(routeLlm('technical', 'outline').reasoningEffort).toBe('low');
    expect(routeLlm('technical', 'draft').reasoningEffort).toBe('low');
    expect(routeLlm('technical', 'humanize').reasoningEffort).toBe('low');
    for (const task of LLM_TASKS) {
      expect(routeLlm('general', task).reasoningEffort).toBeUndefined();
    }
  });
});
