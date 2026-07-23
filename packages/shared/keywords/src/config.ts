import type { SetupPresets } from '@shared/schemas';
import type { PipelineConfig, ResolvedConfig } from './types';

/** Defaults for everything except location/language, which come from presets. */
export const DEFAULT_CONFIG: Omit<ResolvedConfig, 'locationName' | 'languageName'> = {
  difficultyCeiling: 45,
  // Must exceed the worker's 30-day plan so every scheduled entry is
  // SERP-validated + classified, with buffer for SERP rejections.
  serpTopN: 40,
  serpDepth: 20,
  serpTopK: 10,
  volumeCap: 10_000,
  clusterJaccard: 0.6,
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
  duplicateSerpOverlap: 0.6,
  weights: { relevance: 0.35, volume: 0.3, ease: 0.2, trend: 0.1, cannibalization: 0.05 },
  endpointLimits: { keywordsForSite: 200, rankedKeywords: 200, keywordIdeas: 200 },
};

// The scanner's LLM may emit "Global (English)" as the target market, but DataForSEO
// has no worldwide location — fall back to its largest dataset.
const GLOBAL_COUNTRY = 'Global (English)';
const DEFAULT_LOCATION = 'United States';

function toLocationName(country: string): string {
  return country === GLOBAL_COUNTRY ? DEFAULT_LOCATION : country;
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
    authorityDomains: partial.authorityDomains ?? DEFAULT_CONFIG.authorityDomains,
    locationName: partial.locationName ?? toLocationName(presets.business.country),
    languageName: partial.languageName ?? presets.business.language,
  };
}
