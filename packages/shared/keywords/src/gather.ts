import type { DataForSeoClient, LlmClient } from '@shared/providers';
import type { SetupPresets } from '@shared/schemas';
import { buildSeedPrompt, parseSeeds } from './llm-prompts';
import { toWorking } from './normalize';
import type { ResolvedConfig, WorkingCandidate } from './types';

// Top competitor-ranked keywords fed to the seed prompt as extra context.
const SEED_COMPETITOR_WINS = 30;

interface GatherInput {
  websiteUrl: string;
  competitors: string[];
  presets: SetupPresets;
  clients: { dataForSeo: DataForSeoClient; llm: LlmClient };
}

export async function gatherCandidates(
  input: GatherInput,
  config: ResolvedConfig,
): Promise<WorkingCandidate[]> {
  const { dataForSeo, llm } = input.clients;
  const geo = { locationName: config.locationName, languageName: config.languageName };
  const out: WorkingCandidate[] = [];

  const site = await dataForSeo.keywordsForSite({
    target: input.websiteUrl,
    limit: config.endpointLimits.keywordsForSite,
    ...geo,
  });
  for (const m of site) out.push(toWorking(m, 'keywords_for_site', input.websiteUrl));

  const competitorWins: { keyword: string; search_volume: number | null }[] = [];
  for (const competitor of input.competitors) {
    const ranked = await dataForSeo.rankedKeywords({
      target: competitor,
      limit: config.endpointLimits.rankedKeywords,
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

  const seedRes = await llm.complete({
    messages: buildSeedPrompt(input.presets, topWins),
    temperature: 0,
    responseFormat: 'json',
  });
  const seeds = parseSeeds(seedRes.text);
  if (seeds.length > 0) {
    const ideas = await dataForSeo.keywordIdeas({
      keywords: seeds,
      limit: config.endpointLimits.keywordIdeas,
      ...geo,
    });
    for (const m of ideas) out.push(toWorking(m, 'keyword_ideas', seeds.join(', ')));
  }

  return out;
}
