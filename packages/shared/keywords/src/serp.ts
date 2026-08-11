import type { DataForSeoClient, LlmClient, SerpResult } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { chunk, mapWithConcurrency } from './concurrency';
import { reject } from './filters';
import {
  buildSerpJudgmentPrompt,
  FAIL_OPEN_JUDGMENT,
  parseSerpJudgments,
  type SerpJudgment,
} from './llm-prompts';
import type { JudgmentCoverage, ResolvedConfig, WorkingCandidate } from './types';

interface SerpDeps {
  dataForSeo: DataForSeoClient;
  llm: LlmClient;
  presets: SetupPresets;
  config: ResolvedConfig;
  /** Sub-stage marks, so a slow stage is attributable to fetch vs judge (#211). */
  onProgress?: (stage: string, meta?: Record<string, unknown>) => void;
}

// The live SERP endpoint is the pipeline's slowest call (see DataForSEO client:
// 15s timeout, up to 3 attempts). Fetching serpTopN of them one-by-one is what
// pushed the strategy Lambda past its timeout, so fetch them with bounded
// concurrency.
const SERP_FETCH_CONCURRENCY = 12;
// A judge call costs ~30s whether it covers one keyword or ten — the round trip
// dominates, not the tokens. At one call per keyword the judge alone was ~10m30s
// of an 11m33s run, so keywords are batched and only the batches are
// concurrent. 10 keeps the prompt near 4k tokens and bounds how much one
// unparseable body can fail open (#211).
export const SERP_JUDGE_BATCH_SIZE = 10;
const SERP_JUDGE_CONCURRENCY = 8;

function authorityFraction(serp: SerpResult[], topK: number, authority: Set<string>): number {
  const top = serp.slice(0, topK);
  if (top.length === 0) return 0;
  const hits = top.filter((r) => authority.has(r.domain.replace(/^www\./, ''))).length;
  return hits / top.length;
}

function urlSet(serp: SerpResult[], topK: number): Set<string> {
  return new Set(serp.slice(0, topK).map((r) => r.url));
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const u of a) if (b.has(u)) inter++;
  return inter / (a.size + b.size - inter);
}

export async function validateSerp(
  candidates: WorkingCandidate[],
  deps: SerpDeps,
): Promise<{
  accepted: WorkingCandidate[];
  rejected: WorkingCandidate[];
  coverage: JudgmentCoverage;
}> {
  const { config } = deps;
  const progress = deps.onProgress ?? (() => {});
  const authority = new Set(config.authorityDomains.map((d) => d.replace(/^www\./, '')));
  const acceptedSerps: Set<string>[] = [];
  const accepted: WorkingCandidate[] = [];
  const rejected: WorkingCandidate[] = [];

  // Phase 1: fetch every SERP concurrently (order-preserving).
  progress('serp_fetch', { candidates: candidates.length });
  const serps = await mapWithConcurrency(candidates, SERP_FETCH_CONCURRENCY, (c) =>
    deps.dataForSeo.serpGoogleOrganic({
      keyword: c.keyword,
      depth: config.serpDepth,
      locationName: config.locationName,
      languageName: config.languageName,
    }),
  );

  // Phase 2: the authority check is pure, so it can gate the LLM calls up front.
  const authorityRejected = serps.map(
    (serp) => authorityFraction(serp, config.serpTopK, authority) >= config.authorityThreshold,
  );

  // Phase 3: judge intent/locality in batches. Batching changes only how many
  // keywords share a call — each is still judged on its own results, and the
  // verdict is scattered back to the candidate's own index, so phase 4 sees the
  // same per-candidate answers the one-call-per-keyword version produced.
  const pending = candidates.flatMap((c, i) =>
    authorityRejected[i] ? [] : [{ index: i, keyword: c.keyword, serp: serps[i] as SerpResult[] }],
  );
  const batches = chunk(pending, SERP_JUDGE_BATCH_SIZE);
  progress('serp_judge', { candidates: pending.length, batches: batches.length });

  const judgments = new Array<SerpJudgment>(candidates.length).fill(FAIL_OPEN_JUDGMENT);
  const parsedBatches = await mapWithConcurrency(batches, SERP_JUDGE_CONCURRENCY, async (batch) => {
    const res = await deps.llm.complete({
      messages: buildSerpJudgmentPrompt(batch, deps.presets),
      temperature: 0,
      responseFormat: 'json',
    });
    return parseSerpJudgments(res.text, batch.length);
  });

  for (const [batchIndex, batch] of batches.entries()) {
    const result = parsedBatches[batchIndex] as ReturnType<typeof parseSerpJudgments>;
    batch.forEach((item, i) => {
      judgments[item.index] = result.judgments[i] as SerpJudgment;
    });
  }

  const unparseable = parsedBatches.reduce((n, r) => n + r.unparseable, 0);
  const coverage: JudgmentCoverage = {
    sent: pending.length,
    returned: pending.length - unparseable,
    unparseable,
    batches: batches.length,
    failedBatches: parsedBatches.filter((r) => !r.parsed).length,
  };

  // Phase 4: accept in input order — acceptedSerps grows as we go, so the
  // duplicate check sees exactly the prior acceptances the serial loop saw.
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i] as WorkingCandidate;
    const serp = serps[i] as SerpResult[];

    if (authorityRejected[i]) {
      rejected.push(reject(c, 'serp_authority'));
      continue;
    }

    const urls = urlSet(serp, config.serpTopK);
    if (acceptedSerps.some((prev) => overlap(urls, prev) >= config.duplicateSerpOverlap)) {
      rejected.push(reject(c, 'serp_duplicate'));
      continue;
    }

    const judgment = judgments[i] as SerpJudgment;
    if (!judgment.intentSuitable) {
      rejected.push(reject(c, 'serp_intent'));
      continue;
    }
    if (!judgment.localitySuitable) {
      rejected.push(reject(c, 'serp_locality'));
      continue;
    }

    acceptedSerps.push(urls);
    accepted.push({
      ...c,
      serp_validated: true,
      serp_competitors: serp
        .slice(0, config.serpTopK)
        .map(({ rank, url, domain, title }) => ({ rank, url, domain, title })),
    });
  }

  return { accepted, rejected, coverage };
}
