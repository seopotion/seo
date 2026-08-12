import type { SearchIntent } from '@shared/schemas';

/** Normalized keyword metrics returned by the Labs endpoints. */
export interface KeywordMetric {
  keyword: string;
  core_keyword: string | null;
  category_ids: number[];
  search_volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: number | null;
  intent: SearchIntent | null;
}

/** Normalized organic SERP result. */
export interface SerpResult {
  rank: number;
  url: string;
  domain: string;
  title: string;
}

export interface DataForSeoConfig {
  login: string;
  password: string;
  /** Defaults to https://api.dataforseo.com/v3 */
  baseUrl?: string;
  /** Per-request timeout. Default 15000ms. */
  timeoutMs?: number;
  /** Retries on transient errors. Default 2. */
  maxRetries?: number;
  /** Base backoff between retries (ms), doubled each attempt. Default 200. */
  retryDelayMs?: number;
}

/**
 * Labs server-side result shaping. Without these the provider returns an
 * arbitrary `limit`-sized slice, so the client-side ceiling was cutting a random
 * third of the catalogue rather than the best of it (#211).
 *
 * `filters` is a nested array of `[field_path, operator, value]` triples joined
 * by `'and'` / `'or'` (max 8 conditions); `orderBy` holds up to 3
 * `"<field_path>,asc|desc"` rules. Field paths are endpoint-specific — the
 * `keywords_for_site` / `keyword_suggestions` items expose
 * `keyword_info.*` / `keyword_properties.*`, while `ranked_keywords` nests the
 * same fields under `keyword_data.*`.
 */
export interface LabsQueryShape {
  limit?: number;
  orderBy?: string[];
  filters?: unknown[];
}

export interface SiteKeywordsParams extends LabsQueryShape {
  target: string;
  locationName?: string;
  languageName?: string;
}

export interface SeedKeywordsParams extends LabsQueryShape {
  keywords: string[];
  locationName?: string;
  languageName?: string;
}

/** `keyword_suggestions` expands ONE seed at a time, unlike `keyword_ideas`. */
export interface SuggestionKeywordsParams extends LabsQueryShape {
  keyword: string;
  locationName?: string;
  languageName?: string;
}

export interface SerpParams {
  keyword: string;
  locationName?: string;
  languageName?: string;
  depth?: number;
}

/** Normalized backlinks summary — currently only the domain rank (0–1000). */
export interface BacklinksSummary {
  rank: number | null;
}
