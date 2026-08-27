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
 *
 * A candidate whose SERP could not be fetched comes back `unvalidated` rather
 * than accepted or rejected: we have no evidence either way, so it survives
 * into the below-N tier (unschedulable while `serp_validated` is false) instead
 * of being silently judged. Only a failure rate above `maxSerpFailureRate`
 * fails the stage — a single flaky call must not kill a run four stages deep.
 */
export async function validateSerp(
  candidates: WorkingCandidate[],
  deps: SerpDeps,
): Promise<{
  accepted: WorkingCandidate[];
  rejected: WorkingCandidate[];
  unvalidated: WorkingCandidate[];
}> {
  const { config } = deps;
  const authority = new Set(config.authorityDomains.map((d) => d.replace(/^www\./, '')));
  const accepted: WorkingCandidate[] = [];
  const rejected: WorkingCandidate[] = [];
  const unvalidated: WorkingCandidate[] = [];

  const serps = await mapWithConcurrency(candidates, SERP_FETCH_CONCURRENCY, (c) =>
    deps.dataForSeo
      .serpGoogleOrganic({
        keyword: c.keyword,
        depth: config.serpDepth,
        locationName: config.locationName,
        languageName: config.languageName,
      })
      .catch((err: unknown) => (err instanceof Error ? err : new Error(String(err)))),
  );

  const failures = serps.filter((s): s is Error => s instanceof Error);
  if (candidates.length > 0 && failures.length / candidates.length > config.maxSerpFailureRate) {
    throw new Error(
      `strategy aborted: ${failures.length} of ${candidates.length} SERP fetches failed ` +
        `(maxSerpFailureRate ${Math.round(config.maxSerpFailureRate * 100)}%). ` +
        `Last failure: ${failures[failures.length - 1]?.message}`,
    );
  }

  candidates.forEach((c, i) => {
    const serp = serps[i] as SerpResult[] | Error;
    if (serp instanceof Error) {
      unvalidated.push(c);
      return;
    }
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

  return { accepted, rejected, unvalidated };
}
