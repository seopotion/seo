import type { DataForSeoClient, LlmClient } from '@shared/providers';
import type {
  ArticleType,
  CandidateSource,
  CandidateStatus,
  RejectionReason,
  SearchIntent,
  SerpCompetitor,
  SetupPresets,
  TopicRole,
} from '@shared/schemas';

/** A candidate as it flows through the pipeline. `normalized` is the dedup key. */
export interface WorkingCandidate {
  keyword: string;
  normalized: string;
  source: CandidateSource;
  source_context: string | null;
  core_keyword: string | null;
  category_ids: number[];
  topic_cluster_id: string | null;
  topic_cluster_label: string | null;
  topic_role: TopicRole | null;
  topic_content_focus: string | null;
  topic_primary_keyword: string | null;
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
  serp_competitors: SerpCompetitor[] | null;
  /** Set by validateSerp on accept; the only candidates strategy may schedule. */
  serp_validated: boolean;
}

/** Pipeline output — assignable to `CreateCandidateInput` (repo derives normalized_keyword). */
export interface EnrichedCandidate {
  org_id: string;
  keyword: string;
  source: CandidateSource;
  source_context: string | null;
  core_keyword: string | null;
  category_ids: number[];
  topic_cluster_id: string | null;
  topic_cluster_label: string | null;
  topic_role: TopicRole | null;
  topic_content_focus: string | null;
  topic_primary_keyword: string | null;
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
  serp_competitors: SerpCompetitor[] | null;
  serp_validated: boolean;
}

export interface ScoreWeights {
  relevance: number;
  volume: number;
  ease: number;
  trend: number;
  cannibalization: number;
}

/**
 * Per-stage model override. Every one of these calls is structured extraction,
 * not reasoning, and it was a reasoning model burning its whole output budget on
 * reasoning tokens that returned the empty classify body (#211) — so the stage a
 * model is used for is worth choosing per stage. Unset means the LlmClient's own
 * default, which keeps behaviour identical to before this existed.
 */
export interface StageModels {
  seeds?: string;
  relevance?: string;
  serpJudge?: string;
  classify?: string;
  topicClusters?: string;
}

export interface PipelineConfig {
  difficultyCeiling: number;
  /**
   * Candidates whose relevance is at or below this are rejected before the
   * top-N split, so a keyword the model saw no connection to never consumes a
   * SERP-validation slot. 0 means "reject only exact zeros" (#211).
   */
  relevanceFloor: number;
  serpTopN: number;
  serpDepth: number;
  serpTopK: number;
  volumeCap: number;
  authorityDomains: string[];
  authorityThreshold: number;
  weights: ScoreWeights;
  /**
   * Fraction of a stage's keywords the LLM must actually answer for the run to
   * be trusted. Below it the pipeline THROWS rather than finishing: an
   * under-answered relevance stage ranks the pool on volume + ease alone, and an
   * under-answered SERP judge fails every keyword open — both produce a plausible
   * plan built on nothing, which is worse than no plan at all (#211).
   */
  minLlmCoverage: number;
  /** Per-stage model override; unset stages use the LlmClient default. */
  models: StageModels;
  /**
   * Pinned seed keywords. Non-empty skips the seed LLM call entirely, which is
   * the only way to make two runs comparable — the seed model is
   * non-deterministic at temperature 0 and seeds drive the whole
   * keyword_suggestions fan-out (#211).
   */
  seeds: string[];
  /** Server-side `keyword_info.search_volume >=` filter on every gather call. */
  minSearchVolume: number;
  locationName?: string;
  languageName?: string;
  endpointLimits: {
    keywordsForSite: number;
    rankedKeywords: number;
    /** Per seed — gather.ts fans out one call per seed keyword. */
    keywordSuggestions: number;
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

/**
 * How much of the relevance batch the LLM actually scored. `sent - returned`
 * candidates were never judged and keep a NULL relevance_score — which the floor
 * must not confuse with a real 0, since seeding them to 0 meant one empty
 * response rejected the entire pool and shipped an empty 30-day plan (#211).
 */
export interface RelevanceCoverage {
  sent: number;
  returned: number;
  /** Candidates the model explicitly scored 0 — genuine "no connection" verdicts. */
  zero: number;
  batches: number;
  /** Batches whose body did not parse at all — every keyword in them is unscored. */
  failedBatches: number;
}

/**
 * How much of the classify batch the LLM actually answered. Uniform `other` is
 * indistinguishable from a real judgement without these: on the clewas run the
 * single classify call returned an EMPTY body after burning its whole 65k-token
 * output budget on reasoning, and all 78 keywords silently kept
 * parseClassification's `other` seed. `assigned` is the bottom line; the rest
 * say which link in the chain broke (#211).
 */
export interface ClassificationCoverage {
  sent: number;
  /** Rows the model returned across every batch. */
  returned: number;
  /** Rows that resolved to one of the sent keywords, by index or by keyword. */
  matched: number;
  /** Rows whose article_type normalized to a member of ARTICLE_TYPES. */
  typed: number;
  /** Keywords that ended up with a model-assigned type rather than the seed. */
  assigned: number;
  batches: number;
  /** Batches whose body did not parse at all — every keyword in them kept the seed. */
  failedBatches: number;
}

/**
 * How much of the SERP intent/locality judgment the LLM actually answered.
 * parseSerpJudgment fails OPEN, so an unanswered keyword is accepted as if it
 * had been judged suitable — `unparseable` is the only way to see it, and
 * batching makes it matter more since one bad body covers N keywords (#211).
 */
export interface JudgmentCoverage {
  /** Keywords sent to the judge; authority rejects are gated out before it. */
  sent: number;
  /** Keywords the judge returned a parseable verdict for. */
  returned: number;
  /** Keywords that fell back to the fail-open default without being judged. */
  unparseable: number;
  batches: number;
  /** Batches whose body did not parse at all — every keyword in them failed open. */
  failedBatches: number;
}

export interface PipelineStats {
  gathered: number;
  /**
   * The seeds keyword_suggestions was fanned out over — LLM-generated, or the
   * pinned `config.seeds`. Recorded so a run documents the input that decides
   * most of its pool.
   */
  seeds: string[];
  /** Pre-dedupe contribution of each gather source; `gathered` is their sum. */
  gatheredBySource: Record<CandidateSource, number>;
  afterDedupe: number;
  afterBrandNav: number;
  afterCeiling: number;
  scored: number;
  /** Survivors of the relevance floor — the pool the top-N split draws from. */
  afterRelevanceFloor: number;
  /** Candidates sent through SERP validation. */
  serpChecked: number;
  /** Candidates that passed authority, intent, and locality checks. */
  serpValidated: number;
  topicClustering: {
    candidates: number;
    clusters: number;
    targets: number;
    duplicates: number;
    pillars: number;
    supports: number;
  };
  accepted: number;
  rejectedByReason: Record<RejectionReason, number>;
  relevance: RelevanceCoverage;
  judgment: JudgmentCoverage;
  classification: ClassificationCoverage;
}

export interface PipelineResult {
  candidates: EnrichedCandidate[];
  stats: PipelineStats;
}
