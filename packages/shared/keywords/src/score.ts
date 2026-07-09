import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { buildRelevancePrompt, parseRelevance } from './llm-prompts';
import type { ResolvedConfig, WorkingCandidate } from './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

export async function applyRelevance(
  candidates: WorkingCandidate[],
  deps: { llm: LlmClient; presets: SetupPresets },
): Promise<WorkingCandidate[]> {
  if (candidates.length === 0) return candidates;
  const keywords = candidates.map((c) => c.keyword);
  const res = await deps.llm.complete({
    messages: buildRelevancePrompt(keywords, deps.presets),
    temperature: 0,
    responseFormat: 'json',
  });
  const scores = parseRelevance(res.text, keywords);
  return candidates.map((c) => ({ ...c, relevance_score: scores.get(c.keyword) ?? 0 }));
}

export function scoreCandidates(
  candidates: WorkingCandidate[],
  opts: { cannibalSet: Set<string>; config: ResolvedConfig },
): WorkingCandidate[] {
  const { weights, volumeCap } = opts.config;
  const logCap = Math.log10(volumeCap);
  return candidates.map((c) => {
    const volume = c.search_volume === null ? 0 : clamp01(Math.log10(c.search_volume + 1) / logCap);
    const relevance = clamp01(c.relevance_score ?? 0);
    const trend = c.trend === null ? 0.5 : clamp01(0.5 + c.trend / 2);
    const ease = c.difficulty === null ? 0.5 : 1 - clamp01(c.difficulty / 100);
    const cannibal = opts.cannibalSet.has(c.normalized) ? 1 : 0;
    const raw =
      weights.relevance * relevance +
      weights.volume * volume +
      weights.ease * ease +
      weights.trend * trend +
      weights.cannibalization * (1 - cannibal);
    return { ...c, opportunity_score: Math.round(100 * clamp01(raw)) };
  });
}
