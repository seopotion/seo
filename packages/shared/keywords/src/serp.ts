import type { DataForSeoClient, LlmClient, SerpResult } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
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

/** Map with bounded concurrency, preserving input order in the output. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T, i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

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

  // Phase 1: fetch every SERP concurrently (order-preserving). Phase 2 keeps the
  // accept/dedup/LLM decision sequential — a candidate only joins acceptedSerps
  // after passing the LLM judgment, so the duplicate check depends on the order
  // of prior acceptances and must stay serial.
  const serps = await mapWithConcurrency(candidates, SERP_FETCH_CONCURRENCY, (c) =>
    deps.dataForSeo.serpGoogleOrganic({
      keyword: c.keyword,
      depth: config.serpDepth,
      locationName: config.locationName,
      languageName: config.languageName,
    }),
  );

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i] as WorkingCandidate;
    const serp = serps[i] as SerpResult[];

    if (authorityFraction(serp, config.serpTopK, authority) >= config.authorityThreshold) {
      rejected.push(reject(c, 'serp_authority'));
      continue;
    }

    const urls = urlSet(serp, config.serpTopK);
    if (acceptedSerps.some((prev) => overlap(urls, prev) >= config.duplicateSerpOverlap)) {
      rejected.push(reject(c, 'serp_duplicate'));
      continue;
    }

    const res = await deps.llm.complete({
      messages: buildSerpJudgmentPrompt(c.keyword, serp, deps.presets),
      temperature: 0,
      responseFormat: 'json',
    });
    const judgment = parseSerpJudgment(res.text);
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
