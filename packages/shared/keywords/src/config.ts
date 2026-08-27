import type { SetupPresets } from '@shared/schemas';
import type { PipelineConfig, ResolvedConfig } from './types';

/** Defaults for everything except location/language, which come from presets. */
export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'locationName' | 'languageName'> = {
  difficultyCeiling: 45,
  // Relevance is scale-compressed on the current model — genuinely good keywords
  // land at 0.50-0.60 and every accepted candidate is >= 0.10 — so anything
  // above 0 risks emptying the plan. 0 rejects only the exact zeros, which is
  // the model explicitly seeing no connection at all. Tune against the
  // distribution `db strategy-dryrun` prints.
  relevanceFloor: 0,
  // Validate essentially the whole post-floor pool rather than an arbitrary
  // slice of it: at 40 the head terms crowded out exactly the low-volume
  // technical queries a niche B2B can actually win, and a third of the survivors
  // were never validated at all. The SERP stage is now concurrent end to end
  // (see serp.ts), so this costs cents and ~2 minutes, well inside the strategy
  // Lambda's 15-minute budget (#211).
  serpTopN: 150,
  serpDepth: 20,
  serpTopK: 10,
  volumeCap: 10_000,
  authorityDomains: [
    'wikipedia.org',
    'amazon.com',
    'reddit.com',
    'youtube.com',
    'quora.com',
    'linkedin.com',
    'pinterest.com',
  ],
  authorityThreshold: 0.5,
  weights: { relevance: 0.35, volume: 0.3, ease: 0.2, trend: 0.1, cannibalization: 0.05 },
  // Half. A healthy run answers 100% — both measured clewas runs returned every
  // keyword — so any real shortfall is a truncated or empty body, and those are
  // all-or-nothing per call: the question is how many BATCHES died, not how many
  // keywords. At ~10 relevance batches this tolerates one or two dead ones
  // (ranking degrades, the survivors still rank sensibly) and catches the failure
  // that actually happened — a whole stage returning nothing. Set it near 1.0 to
  // demand a perfect stage; 0 disables the guard (#211).
  minLlmCoverage: 0.5,
  // A fifth. Live SERP failures are per-keyword and independent (unlike the LLM
  // batches minLlmCoverage guards), so a handful of casualties out of serpTopN
  // costs a few candidates from a pool that over-supplies the 30-day plan. Past
  // a fifth it is no longer bad luck — the provider or our credentials are down,
  // and finishing would ship a plan validated against almost nothing.
  maxSerpFailureRate: 0.2,
  // Unset = the LlmClient's default model for that stage.
  models: {
    plan: 'anthropic/claude-haiku-4.5',
  },
  // Empty = ask the LLM for seeds, the production path. Pin them for benchmark
  // runs, where a non-deterministic seed list swings the pool +/-40% and swamps
  // whatever change is being measured (#211).
  seeds: [],
  // Drops the zero-demand tail server-side. Deliberately low: the winnable B2B
  // intent lives in low-volume technical queries, so this is a "has any measured
  // demand" cut, not a quality bar (#211).
  minSearchVolume: 10,
  // Raised now that `filters` + `order_by` make the slice the *best* N rather
  // than an arbitrary N. keywordSuggestions is per-seed (see gather.ts), so its
  // ceiling is limit x SUGGESTION_SEEDS; it is the only source that reliably
  // returns on-topic long-tail, so it gets the headroom. keywordsForSite is
  // capped lower on purpose — past its relevant head it is noise that only
  // inflates the single-call relevance prompt (#211).
  endpointLimits: { keywordsForSite: 300, rankedKeywords: 300, keywordSuggestions: 100 },
};

// The scanner's LLM may emit "Global (English)" as the target market, but DataForSEO
// has no worldwide location — fall back to its largest dataset.
const GLOBAL_COUNTRY = 'Global (English)';
const DEFAULT_LOCATION = 'United States';
const LOCATION_ALIASES: Record<string, string> = {
  Turkey: 'Turkiye',
};

function toLocationName(country: string): string {
  if (country === GLOBAL_COUNTRY) return DEFAULT_LOCATION;
  return LOCATION_ALIASES[country] ?? country;
}

/** Merge defaults + caller overrides, deriving location/language from presets when absent. */
export function resolveConfig(
  presets: SetupPresets,
  partial: Partial<PipelineConfig> = {},
): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    weights: { ...DEFAULT_CONFIG.weights, ...partial.weights },
    endpointLimits: { ...DEFAULT_CONFIG.endpointLimits, ...partial.endpointLimits },
    models: { ...DEFAULT_CONFIG.models, ...partial.models },
    authorityDomains: partial.authorityDomains ?? DEFAULT_CONFIG.authorityDomains,
    seeds: partial.seeds ?? DEFAULT_CONFIG.seeds,
    locationName: partial.locationName ?? toLocationName(presets.business.country),
    languageName: partial.languageName ?? presets.business.language,
  };
}
