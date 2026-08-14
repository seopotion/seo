import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { chunk, mapWithConcurrency } from './concurrency';
import { buildRelevancePrompt, parseRelevance } from './llm-prompts';
import type { RelevanceCoverage, ResolvedConfig, WorkingCandidate } from './types';

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

/**
 * Sized from the recorded clewas calls: ~7 prompt tokens and ~30-34 completion
 * tokens per keyword (reasoning included). At 50 a batch spends ~1.7k of the
 * model's 65,536-token output ceiling — a ~38x margin, so a reasoning blowup has
 * to be extraordinary before it truncates. It also puts a ~500-keyword pool at
 * ~10 batches, which keeps one dead batch at ~10% coverage loss, comfortably
 * inside the minLlmCoverage guard (#211).
 */
export const RELEVANCE_BATCH_SIZE = 50;
// Matches the SERP judge. Relevance prompts are small, so a call is ~7s rather
// than the judge's ~30s: 9 batches at 8 wide is two waves, measured at 14.0s for
// the whole stage against 197.5s for the single call it replaced (#211).
const RELEVANCE_CONCURRENCY = 8;

const EMPTY_COVERAGE: RelevanceCoverage = {
  sent: 0,
  returned: 0,
  zero: 0,
  batches: 0,
  failedBatches: 0,
};

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
 * Score relevance in batches. This was the pipeline's last single-call stage,
 * which made it the last one where a single empty body could decide the whole
 * run — structurally the failure that broke classify (#211). A batch that comes
 * back unparseable now costs only its own keywords: they stay NULL, which is
 * "never judged", not "scored 0". The caller enforces a coverage floor on top.
 *
 * An unparseable batch gets one repair retry — the same ladder the plan call
 * uses — before it is counted failed, since a single dead body otherwise costs
 * the whole batch for what is often a transient formatting slip.
 */
export async function applyRelevance(
  candidates: WorkingCandidate[],
  deps: { llm: LlmClient; presets: SetupPresets; model?: string },
): Promise<{ candidates: WorkingCandidate[]; coverage: RelevanceCoverage }> {
  if (candidates.length === 0) return { candidates, coverage: EMPTY_COVERAGE };

  const batches = chunk(
    candidates.map((c) => c.keyword),
    RELEVANCE_BATCH_SIZE,
  );
  const results = await mapWithConcurrency(batches, RELEVANCE_CONCURRENCY, async (keywords) => {
    const messages = buildRelevancePrompt(keywords, deps.presets);
    const first = await deps.llm.complete({
      messages,
      model: deps.model,
      temperature: 0,
      responseFormat: 'json',
    });
    const parsed = parseRelevance(first.text, keywords);
    if (parsed.parsed) return parsed;

    const retry = await deps.llm.complete({
      messages: [
        ...messages,
        { role: 'assistant', content: first.text },
        {
          role: 'user',
          content:
            'Your previous response could not be parsed. Return the complete corrected JSON — nothing else.',
        },
      ],
      model: deps.model,
      temperature: 0,
      responseFormat: 'json',
    });
    return parseRelevance(retry.text, keywords);
  });

  const scores = new Map(results.flatMap((r) => [...r.scores]));
  const scored = candidates.map((c) => ({
    ...c,
    relevance_score: scores.get(c.keyword) ?? null,
  }));
  return {
    candidates: scored,
    coverage: {
      sent: candidates.length,
      returned: scores.size,
      zero: scored.filter((c) => c.relevance_score === 0).length,
      batches: batches.length,
      failedBatches: results.filter((r) => !r.parsed).length,
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
