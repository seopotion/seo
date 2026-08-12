import type { LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { chunk, mapWithConcurrency } from './concurrency';
import { buildClassifyPrompt, parseClassification } from './llm-prompts';
import type { ClassificationCoverage, WorkingCandidate } from './types';

/**
 * One call for the whole accepted pool put every keyword behind a single point
 * of failure, and on the clewas run that call returned an empty body after
 * exhausting its output budget — all 78 keywords silently kept the `other` seed.
 * Batching bounds the blast radius to one batch and keeps each call's output
 * small enough that the reasoning budget is not the binding constraint (#211).
 */
export const CLASSIFY_BATCH_SIZE = 25;
const CLASSIFY_CONCURRENCY = 4;

const EMPTY_COVERAGE: ClassificationCoverage = {
  sent: 0,
  returned: 0,
  matched: 0,
  typed: 0,
  assigned: 0,
  batches: 0,
  failedBatches: 0,
};

export async function classifyCandidates(
  candidates: WorkingCandidate[],
  deps: { llm: LlmClient; presets: SetupPresets; model?: string },
): Promise<{ candidates: WorkingCandidate[]; coverage: ClassificationCoverage }> {
  if (candidates.length === 0) return { candidates, coverage: EMPTY_COVERAGE };

  const batches = chunk(
    candidates.map((c) => c.keyword),
    CLASSIFY_BATCH_SIZE,
  );

  const results = await mapWithConcurrency(batches, CLASSIFY_CONCURRENCY, async (keywords) => {
    const res = await deps.llm.complete({
      messages: buildClassifyPrompt(keywords, deps.presets),
      model: deps.model,
      temperature: 0,
      responseFormat: 'json',
    });
    return parseClassification(res.text, keywords);
  });

  const types = new Map(results.flatMap((r) => [...r.types]));
  const coverage = results.reduce<ClassificationCoverage>(
    (acc, r) => ({
      sent: acc.sent + r.coverage.sent,
      returned: acc.returned + r.coverage.returned,
      matched: acc.matched + r.coverage.matched,
      typed: acc.typed + r.coverage.typed,
      assigned: acc.assigned + r.coverage.assigned,
      batches: acc.batches + 1,
      failedBatches: acc.failedBatches + r.coverage.failedBatches,
    }),
    EMPTY_COVERAGE,
  );

  return {
    candidates: candidates.map((c) => ({ ...c, article_type: types.get(c.keyword) ?? 'other' })),
    coverage,
  };
}
