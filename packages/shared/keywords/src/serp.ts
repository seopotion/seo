import type { DataForSeoClient, SerpResult } from '@shared/providers';
import { mapWithConcurrency } from './concurrency';
import { reject } from './filters';
import type { ResolvedConfig, WorkingCandidate } from './types';

interface SerpDeps {
  dataForSeo: DataForSeoClient;
  config: ResolvedConfig;
}

// The live SERP endpoint is the pipeline's slowest call (see DataForSEO client:
// 15s timeout, up to 3 attempts). Fetching serpTopN of them one-by-one is what
// pushed the strategy Lambda past its timeout, so fetch them with bounded
// concurrency.
export const SERP_FETCH_CONCURRENCY = 12;

function authorityFraction(serp: SerpResult[], topK: number, authority: Set<string>): number {
  const top = serp.slice(0, topK);
  if (top.length === 0) return 0;
  const hits = top.filter((r) => authority.has(r.domain.replace(/^www\./, ''))).length;
  return hits / top.length;
}

/**
 * Fetch every candidate's SERP and gate on authority — the only pure,
 * non-LLM part of the old SERP judge. Intent/locality now fold into the plan
 * call (#211 / strategy rearchitect), so this stage no longer talks to an LLM
 * at all.
 */
export async function validateSerp(
  candidates: WorkingCandidate[],
  deps: SerpDeps,
): Promise<{ accepted: WorkingCandidate[]; rejected: WorkingCandidate[] }> {
  const { config } = deps;
  const authority = new Set(config.authorityDomains.map((d) => d.replace(/^www\./, '')));
  const accepted: WorkingCandidate[] = [];
  const rejected: WorkingCandidate[] = [];

  const serps = await mapWithConcurrency(candidates, SERP_FETCH_CONCURRENCY, (c) =>
    deps.dataForSeo.serpGoogleOrganic({
      keyword: c.keyword,
      depth: config.serpDepth,
      locationName: config.locationName,
      languageName: config.languageName,
    }),
  );

  candidates.forEach((c, i) => {
    const serp = serps[i] as SerpResult[];
    if (authorityFraction(serp, config.serpTopK, authority) >= config.authorityThreshold) {
      rejected.push(reject(c, 'serp_authority'));
      return;
    }
    accepted.push({
      ...c,
      serp_competitors: serp
        .slice(0, config.serpTopK)
        .map(({ rank, url, domain, title }) => ({ rank, url, domain, title })),
    });
  });

  return { accepted, rejected };
}
