import type { DataForSeoClient, LlmClient, SerpResult } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { mapWithConcurrency } from './concurrency';
import { reject } from './filters';
import { buildSerpJudgmentPrompt, parseSerpJudgment } from './llm-prompts';
import type { ResolvedConfig, WorkingCandidate } from './types';

interface SerpDeps {
  dataForSeo: DataForSeoClient;
  llm: LlmClient;
  presets: SetupPresets;
  config: ResolvedConfig;
}

// The live SERP endpoint is the pipeline's slowest call (see DataForSEO client:
// 15s timeout, up to 3 attempts). Fetching serpTopN of them one-by-one is what
// pushed the strategy Lambda past its timeout, so fetch them with bounded
// concurrency. Kept small to stay under the provider's rate limits.
const SERP_FETCH_CONCURRENCY = 6;
// The per-keyword intent judgment used to run serially behind the fetches,
// which made the whole stage O(serpTopN) round-trips — the reason serpTopN
// could not be raised past 40 (#211).
const SERP_JUDGE_CONCURRENCY = 6;

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
): Promise<{ accepted: WorkingCandidate[]; rejected: WorkingCandidate[] }> {
  const { config } = deps;
  const authority = new Set(config.authorityDomains.map((d) => d.replace(/^www\./, '')));
  const acceptedSerps: Set<string>[] = [];
  const accepted: WorkingCandidate[] = [];
  const rejected: WorkingCandidate[] = [];

  // Phase 1: fetch every SERP concurrently (order-preserving).
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

  // Phase 3: judge intent/locality concurrently. Independent per keyword — the
  // duplicate-overlap check is the only order-dependent step, and it is applied
  // in phase 4. A candidate phase 4 later rejects as serp_duplicate has its
  // judgment discarded; that reason has never fired, so nothing is wasted in
  // practice and the decision order stays identical to the serial version.
  const judgments = await mapWithConcurrency(candidates, SERP_JUDGE_CONCURRENCY, async (c, i) => {
    if (authorityRejected[i]) return null;
    const res = await deps.llm.complete({
      messages: buildSerpJudgmentPrompt(c.keyword, serps[i] as SerpResult[], deps.presets),
      temperature: 0,
      responseFormat: 'json',
    });
    return parseSerpJudgment(res.text);
  });

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

    const judgment = judgments[i] as ReturnType<typeof parseSerpJudgment>;
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

  return { accepted, rejected };
}
