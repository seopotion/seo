import type { DataForSeoClient, LlmClient } from '@shared/providers';
import type {
  ArticleType,
  CandidateSource,
  CandidateStatus,
  RejectionReason,
  SearchIntent,
  SetupPresets,
} from '@shared/schemas';

/** A candidate as it flows through the pipeline. `normalized` is the dedup key. */
export interface WorkingCandidate {
  keyword: string;
  normalized: string;
  source: CandidateSource;
  source_context: string | null;
  search_volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number | null;
  intent: SearchIntent | null;
  relevance_score: number | null;
  opportunity_score: number | null;
  article_type: ArticleType | null;
  rejection_reason: RejectionReason | null;
  status: CandidateStatus;
  serp_competitors: string[] | null;
}

/** Pipeline output — assignable to `CreateCandidateInput` (repo derives normalized_keyword). */
export interface EnrichedCandidate {
  org_id: string;
  keyword: string;
  source: CandidateSource;
  source_context: string | null;
  search_volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number | null;
  intent: SearchIntent | null;
  relevance_score: number | null;
  opportunity_score: number | null;
  article_type: ArticleType | null;
  rejection_reason: RejectionReason | null;
  status: CandidateStatus;
  serp_competitors: string[] | null;
}

export interface ScoreWeights {
  relevance: number;
  volume: number;
  ease: number;
  trend: number;
  cannibalization: number;
}

export interface PipelineConfig {
  difficultyCeiling: number;
  serpTopN: number;
  serpDepth: number;
  serpTopK: number;
  volumeCap: number;
  clusterJaccard: number;
  authorityDomains: string[];
  authorityThreshold: number;
  duplicateSerpOverlap: number;
  weights: ScoreWeights;
  locationName?: string;
  languageName?: string;
  endpointLimits: {
    keywordsForSite: number;
    rankedKeywords: number;
    keywordIdeas: number;
  };
}

/** Config after defaults + preset-derived location/language are applied. */
export type ResolvedConfig = Required<Omit<PipelineConfig, 'locationName' | 'languageName'>> & {
  locationName?: string;
  languageName?: string;
};

export interface PipelineInput {
  orgId: string;
  websiteUrl: string;
  presets: SetupPresets;
  competitors: string[];
  existingKeywords: string[];
  existingArticleKeywords: string[];
  clients: { dataForSeo: DataForSeoClient; llm: LlmClient };
  config?: Partial<PipelineConfig>;
  /**
   * Optional per-stage progress hook. Called at the entry of each async stage so
   * a mid-stage hang (e.g. a slow provider) is attributable to the last stage
   * logged. The strategy worker wires this to its structured logger.
   */
  onProgress?: (stage: string, meta?: Record<string, unknown>) => void;
}

export interface PipelineStats {
  gathered: number;
  afterDedupe: number;
  afterBrandNav: number;
  clustered: number;
  afterCeiling: number;
  scored: number;
  serpValidated: number;
  accepted: number;
  rejectedByReason: Record<RejectionReason, number>;
}

export interface PipelineResult {
  candidates: EnrichedCandidate[];
  stats: PipelineStats;
}
