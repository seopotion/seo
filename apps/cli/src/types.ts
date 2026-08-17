/**
 * Core types for the seo CLI.
 *
 * Every lib function returns Result<T>. Errors are structured and
 * machine-readable. Commands translate Results into output + exit codes.
 */
import type { PipelineStats, ResolvedConfig } from '@shared/keywords';

export interface CliError {
  code: string;
  message: string;
  suggestion?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: CliError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: string, message: string, suggestion?: string): Result<never> => ({
  ok: false,
  error: { code, message, suggestion },
});

export const EXIT = {
  SUCCESS: 0,
  USER_ERROR: 1,
  INFRA_DOWN: 2,
  OP_FAILED: 3,
  INTERNAL: 4,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type OutputMode = 'text' | 'json';

export interface Emitter {
  step(name: string, status: 'start' | 'done' | 'fail', detail?: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  result<T>(data: Result<T>): void;
}

export type InfraService = 'mongo' | 'sqs' | 'api';

export interface ServiceCheck {
  service: InfraService;
  available: boolean;
  latencyMs?: number;
  error?: string;
}

export interface InfraCheckResult {
  allHealthy: boolean;
  services: ServiceCheck[];
}

export interface DbInitData {
  collections: string[];
}

export interface SetPlanData {
  org_id: string;
  plan: string;
  /**
   * True when escalating to paid kicked off the 30-day strategy pipeline.
   * Name predates the SQS→SFN switch (#56); kept for output-contract stability.
   */
  strategy_enqueued: boolean;
}

export interface StrategyRunData {
  run_id: string;
}

export interface ResetUserData {
  user_id: string;
  org_ids: string[];
  /** Active provider (LemonSqueezy) subscriptions cancelled before deletion. */
  cancelled_subscriptions: number;
  deleted: {
    orgs: number;
    keywords: number;
    candidates: number;
    articles: number;
    gsc_connections: number;
    subscriptions: number;
  };
}

export interface DeleteUserData extends ResetUserData {
  user_deleted: boolean;
}

/**
 * `db delete-org` report. The `orgs` list is populated in both modes, so a dry
 * run shows exactly what `--apply` would remove; every `deleted` count is 0
 * until `--apply`. Users are never touched — only org-scoped data.
 */
export interface DeleteOrgData {
  apply: boolean;
  orgs: {
    id: string;
    website_url: string;
    user_id: string | null;
    plan: string | null;
    setup_status: string | null;
  }[];
  /** Active provider subscriptions found across the targets (counted in both modes). */
  active_subscriptions: number;
  /** Of those, how many were actually cancelled — 0 on a dry run. */
  cancelled_subscriptions: number;
  deleted: {
    orgs: number;
    keywords: number;
    candidates: number;
    articles: number;
    gsc_connections: number;
    subscriptions: number;
    integrations: number;
    strategy_runs: number;
    gsc_analytics_cache: number;
  };
}

/**
 * `db reset-images` report. `reset` is populated in both modes, so a dry run
 * shows exactly what `--apply` would blank; `enqueued` is 0 without `--enqueue`,
 * and those articles still need an image replay before they can be republished.
 */
export interface ResetImagesData {
  apply: boolean;
  /** The dead CDN host that was matched against, lowercased. */
  host: string;
  scanned: number;
  slotsReset: number;
  enqueued: number;
  reset: { id: string; title: string; status: string; slots: number }[];
}

export type Stage = 'staging' | 'prod';

export interface PrereqCheck {
  name: string; // SSM parameter name or env var name
  kind: 'ssm' | 'env';
  present: boolean;
  error?: string;
}

export interface PreflightResult {
  stage: Stage;
  ready: boolean;
  checks: PrereqCheck[];
}

/** Half-open `[min, max)` range used to bucket a numeric distribution. */
export interface Bucket {
  label: string;
  min: number;
  max: number;
}

export interface BucketCount {
  label: string;
  count: number;
}

/** Five-number summary over the non-null values, plus how many were null. */
export interface NumericStats {
  /** Non-null values summarized. */
  count: number;
  nulls: number;
  min: number | null;
  p25: number | null;
  median: number | null;
  p75: number | null;
  max: number | null;
}

/** Whole-pool histograms — every candidate for the org, all statuses. */
export interface AuditPool {
  total: number;
  by_source: Record<string, number>;
  by_status: Record<string, number>;
  /** `(none)` counts candidates with a null rejection_reason. */
  by_rejection_reason: Record<string, number>;
  relevance_score: {
    nulls: number;
    /** Exactly 0 — the parseRelevance seed value, not necessarily a real score. */
    exact_zero: number;
    stats: NumericStats;
    /** Ten 0.1-wide buckets over the non-null values. */
    histogram: BucketCount[];
  };
  opportunity_score: NumericStats;
  difficulty: { nulls: number; exact_zero: number; one_to_45: number; above_45: number };
  search_volume: { nulls: number; zero: number; buckets: BucketCount[] };
  /** Candidates with serp_competitors != null, i.e. actually SERP-validated. */
  serp_validated: number;
}

/** One scheduled planner entry, joined to its candidate via `candidate_id`. */
export interface AuditPlanRow {
  scheduled_date: string;
  keyword: string;
  search_volume: number;
  difficulty: number;
  opportunity_score: number | null;
  article_type: string | null;
  /** From the joined candidate; null when no candidate could be found. */
  relevance_score: number | null;
  source: string | null;
  /** How the candidate was found: by `candidate_id`, or by normalized keyword
   * for pre-#99 entries that carry no linkage. */
  candidate_join: 'candidate_id' | 'normalized_keyword' | 'none';
  serp_validated: boolean;
}

export interface AuditDiagnostics {
  /** Scheduled entries that never went through SERP validation. */
  backfill_count: number;
  backfill_fraction: number;
  relevance_exact_zero: { scored: number; exact_zero: number; fraction: number };
  kd_zero_scheduled: number;
  scheduled_by_source: Record<string, number>;
  pool_source_share: Record<string, number>;
  scheduled_source_share: Record<string, number>;
}

/** `db strategy-audit` report (#211) — read-only diagnostics for the 30-day plan. */
export interface StrategyAuditData {
  org: {
    id: string;
    website_url: string;
    plan: string;
    strategy_status: string;
    setup_status: string;
    business: { name: string; country: string; language: string } | null;
    audience_target: string[];
    competitors: string[];
    /** No competitors disables the ranked_keywords branch of gather.ts entirely. */
    competitors_empty: boolean;
  };
  pool: AuditPool;
  plan: AuditPlanRow[];
  diagnostics: AuditDiagnostics;
  /** Full candidate records matching `--keyword`; empty when the flag is unused. */
  keyword_matches: unknown[];
  notes: string[];
}

/** One candidate as the dry-run report shows it. */
export interface DryRunCandidateRow {
  keyword: string;
  source: string;
  search_volume: number | null;
  difficulty: number | null;
  relevance_score: number | null;
  opportunity_score: number | null;
  article_type: string | null;
  rejection_reason: string | null;
}

export interface DryRunPlanRow extends DryRunCandidateRow {
  scheduled_date: string;
  topic_cluster_id: string;
  topic_cluster_label: string;
  topic_role: 'pillar' | 'support';
  /** Scored but never SERP-validated or classified — today's silent backfill. */
  from_below_n: boolean;
}

/** `db strategy-dryrun` report (#211) — one pipeline run, persisted nowhere. */
export interface StrategyDryRunData {
  mode: 'live' | 'replay';
  org: {
    id: string;
    website_url: string;
    business: { name: string; country: string; language: string };
    competitors: string[];
  };
  config: ResolvedConfig;
  stats: PipelineStats;
  /**
   * Wall clock per stage, from each `onProgress` mark to the next (so the first
   * entry covers gather through the next stage). The strategy Lambda aborts at
   * `budget_ms`, so `total_ms` against it is the answer to "does serpTopN still
   * fit" (#211).
   */
  timing: { total_ms: number; budget_ms: number; stages: { stage: string; ms: number }[] };
  /**
   * Per-source funnel. `after_dedupe` counts the source's survivors in the
   * pipeline output, so `gathered - after_dedupe` is what dedupe dropped from
   * that source — near-zero overlap between sources is the tell that they are
   * describing different businesses (#211).
   */
  sources: { source: string; gathered: number; after_dedupe: number }[];
  /**
   * article_type across the accepted pool. Uniform `other` is the classifier
   * failing, not judging; this remains diagnostic and does not order the plan.
   */
  article_types: { article_type: string; count: number }[];
  /** The known failure: relevance the LLM never scored keeps parseRelevance's 0 seed. */
  relevance: {
    sent: number;
    returned: number;
    missing: number;
    zero: number;
    zero_fraction: number;
    /** Histogram for tuning `relevanceFloor`; `cumulative` = rejected at that `max`. */
    distribution: { label: string; max: number; count: number; cumulative: number }[];
    /** Lowest relevance among the planned entries — a floor at/above this empties slots. */
    plan_min: number | null;
  };
  sections: {
    /** SERP-validated and classified. */
    accepted: DryRunCandidateRow[];
    /** Below serpTopN: scored, never SERP-validated, never schedulable (#211). */
    below_n: DryRunCandidateRow[];
    rejected: { reason: string; candidates: DryRunCandidateRow[] }[];
  };
  /** What strategy.ts would schedule for a first run of this org. */
  plan: DryRunPlanRow[];
  snapshot: {
    wrote: string | null;
    replayed: string | null;
    config_drift: string[];
    /** Calls `--allow-live-misses` had to fetch live; null when not in that mode. */
    live_misses: { dataforseo: number; llm: number } | null;
  };
  notes: string[];
}

/** `db clean-links` report (#186). `publishedChanged` are live articles whose
 * content changed — republish them so the fix reaches the customer's site. */
export interface CleanLinksData {
  org: string;
  apply: boolean;
  /** Verified live URLs every link is checked against. 0 means the org has no
   * reachable published page, so EVERY link is stripped — expected, but it
   * explains an otherwise alarming `changed` count. */
  allowedUrls: number;
  scanned: number;
  changed: number;
  linksRemoved: number;
  publishedChanged: { id: string; title: string }[];
}
