import type { DataForSeoClient, LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { mapWithConcurrency } from './concurrency';
import { buildSeedPrompt, parseSeeds, SEED_RESPONSE_SCHEMA } from './llm-prompts';
import { toWorking } from './normalize';
import type { ResolvedConfig, WorkingCandidate } from './types';

// Top competitor-ranked keywords fed to the seed prompt as extra context.
const SEED_COMPETITOR_WINS = 30;
// keyword_suggestions expands one seed per call, so the seed count multiplies
// both the request count and the pool. Capped so the single-call relevance
// stage keeps scoring the whole pool in one response.
const SUGGESTION_SEEDS = 15;
const SUGGESTION_CONCURRENCY = 4;

interface GatherInput {
  websiteUrl: string;
  competitors: string[];
  presets: SetupPresets;
  clients: { dataForSeo: DataForSeoClient; llm: LlmClient };
}

/**
 * Returns the seeds alongside the candidates: they decide most of the pool, and
 * a run that cannot say what its own inputs were is not comparable to any other
 * run (#211).
 */
export async function gatherCandidates(
  input: GatherInput,
  config: ResolvedConfig,
): Promise<{ candidates: WorkingCandidate[]; seeds: string[] }> {
  const { dataForSeo, llm } = input.clients;
  const geo = { locationName: config.locationName, languageName: config.languageName };
  const out: WorkingCandidate[] = [];

  // Shape the slice server-side. Without these, `limit` returns an arbitrary N
  // out of everything the endpoint knows; `ranked_keywords` nests the same
  // fields one level deeper (#211).
  const volumeFilter = (path: string) => [[path, '>=', config.minSearchVolume]];
  const byVolume = (path: string) => [`${path},desc`];
  const LABS = 'keyword_info.search_volume';
  const RANKED = 'keyword_data.keyword_info.search_volume';

  const site = await dataForSeo.keywordsForSite({
    target: input.websiteUrl,
    limit: config.endpointLimits.keywordsForSite,
    // Deliberately the endpoint's own `relevance` order, not volume: this is a
    // loose site<->keyword association, and its high-volume head is generic
    // noise ("oil prices today" for a desalination SaaS). Measured — ordering it
    // by volume made the pool 96% relevance-zero (#211).
    orderBy: ['relevance,desc'],
    filters: volumeFilter(LABS),
    ...geo,
  });
  for (const m of site) out.push(toWorking(m, 'keywords_for_site', input.websiteUrl));

  const competitorWins: { keyword: string; search_volume: number | null }[] = [];
  for (const competitor of input.competitors) {
    const ranked = await dataForSeo.rankedKeywords({
      target: competitor,
      limit: config.endpointLimits.rankedKeywords,
      orderBy: byVolume(RANKED),
      filters: volumeFilter(RANKED),
      ...geo,
    });
    for (const m of ranked) {
      out.push(toWorking(m, 'ranked_keywords', competitor));
      competitorWins.push({ keyword: m.keyword, search_volume: m.search_volume });
    }
  }
  const topWins = competitorWins
    .sort((a, b) => (b.search_volume ?? -1) - (a.search_volume ?? -1))
    .slice(0, SEED_COMPETITOR_WINS)
    .map((w) => w.keyword);

  // Pinned seeds skip the LLM entirely rather than merely overriding its answer:
  // the point is a run with no non-deterministic input, and the call is also the
  // one whose output swung the pool +/-40% between identical runs (#211).
  const seeds =
    config.seeds.length > 0
      ? config.seeds.slice(0, SUGGESTION_SEEDS)
      : parseSeeds(
          (
            await llm.complete({
              messages: buildSeedPrompt(input.presets, topWins),
              model: config.models.seeds,
              temperature: 0,
              responseSchema: SEED_RESPONSE_SCHEMA,
            })
          ).text,
        ).slice(0, SUGGESTION_SEEDS);
  const suggestionSets = await mapWithConcurrency(seeds, SUGGESTION_CONCURRENCY, (seed) =>
    dataForSeo.keywordSuggestions({
      keyword: seed,
      limit: config.endpointLimits.keywordSuggestions,
      orderBy: byVolume(LABS),
      filters: volumeFilter(LABS),
      ...geo,
    }),
  );
  for (const [i, suggestions] of suggestionSets.entries()) {
    for (const m of suggestions) out.push(toWorking(m, 'keyword_suggestions', seeds[i] as string));
  }

  return { candidates: out, seeds };
}
