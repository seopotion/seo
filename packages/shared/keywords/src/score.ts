import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { buildRelevancePrompt, parseRelevance } from './llm-prompts';
import type { RelevanceCoverage, ResolvedConfig, WorkingCandidate } from './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/** Above this volume, a difficulty of 0 reads as missing data rather than a real KD. */
const UNKNOWN_DIFFICULTY_VOLUME = 1000;

/**
 * Ease of ranking, 0..1. DataForSEO reports difficulty 0 both for genuinely
 * trivial long-tail keywords and for keywords it simply has no KD data on, so
 * mapping 0 to the maximum ease made a missing-data signal score as an ideal
 * one (#211). Volume is the tell: a keyword with real search volume and KD 0
 * is almost always unmeasured, so it gets the same neutral 0.5 as a null.
 */
function ease(difficulty: number | null, searchVolume: number | null): number {
  if (difficulty === null) return 0.5;
  if (difficulty === 0 && (searchVolume ?? 0) > UNKNOWN_DIFFICULTY_VOLUME) return 0.5;
  return 1 - clamp01(difficulty / 100);
}

/**
 * Score relevance for the whole batch in one LLM call. Returns the coverage
 * alongside the candidates: relevance carries the largest scoring weight, so a
 * response that covers only part of the batch silently degrades ranking to
 * volume + ease, and the counts are the only way to see it (#211).
 */
export async function applyRelevance(
  candidates: WorkingCandidate[],
  deps: { llm: LlmClient; presets: SetupPresets },
): Promise<{ candidates: WorkingCandidate[]; coverage: RelevanceCoverage }> {
  if (candidates.length === 0) {
    return { candidates, coverage: { sent: 0, returned: 0, zero: 0 } };
  }
  const keywords = candidates.map((c) => c.keyword);
  const res = await deps.llm.complete({
    messages: buildRelevancePrompt(keywords, deps.presets),
    temperature: 0,
    responseFormat: 'json',
  });
  const { scores, returned } = parseRelevance(res.text, keywords);
  const scored = candidates.map((c) => ({ ...c, relevance_score: scores.get(c.keyword) ?? 0 }));
  return {
    candidates: scored,
    coverage: {
      sent: keywords.length,
      returned,
      zero: scored.filter((c) => c.relevance_score === 0).length,
    },
  };
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
    const cannibal = opts.cannibalSet.has(c.normalized) ? 1 : 0;
    const raw =
      weights.relevance * relevance +
      weights.volume * volume +
      weights.ease * ease(c.difficulty, c.search_volume) +
      weights.trend * trend +
      weights.cannibalization * (1 - cannibal);
    return { ...c, opportunity_score: Math.round(100 * clamp01(raw)) };
  });
}
