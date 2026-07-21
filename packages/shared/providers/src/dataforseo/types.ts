import type { SearchIntent } from '@shared/schemas';

/** Normalized keyword metrics returned by the Labs endpoints. */
export interface KeywordMetric {
  keyword: string;
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

export interface SiteKeywordsParams {
  target: string;
  locationName?: string;
  languageName?: string;
  limit?: number;
}

export interface SeedKeywordsParams {
  keywords: string[];
  locationName?: string;
  languageName?: string;
  limit?: number;
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
