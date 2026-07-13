import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { buildClassifyPrompt, parseClassification } from './llm-prompts';
import type { WorkingCandidate } from './types';

export async function classifyCandidates(
  candidates: WorkingCandidate[],
  deps: { llm: LlmClient; presets: SetupPresets },
): Promise<WorkingCandidate[]> {
  if (candidates.length === 0) return candidates;
  const keywords = candidates.map((c) => c.keyword);
  const res = await deps.llm.complete({
    messages: buildClassifyPrompt(keywords, deps.presets),
    temperature: 0,
    responseFormat: 'json',
  });
  const types = parseClassification(res.text, keywords);
  return candidates.map((c) => ({ ...c, article_type: types.get(c.keyword) ?? 'other' }));
}
