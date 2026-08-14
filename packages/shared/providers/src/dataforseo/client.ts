import type { SearchIntent } from '@shared/schemas';
import { SEARCH_INTENTS } from '@shared/schemas';
import { bodySnippet } from '../errors';
import { categorizeApiStatus, categorizeHttpStatus, DataForSeoError, isRetryable } from './errors';
import type {
  BacklinksSummary,
  DataForSeoConfig,
  KeywordMetric,
  LabsQueryShape,
  SeedKeywordsParams,
  SerpParams,
  SerpResult,
  SiteKeywordsParams,
  SuggestionKeywordsParams,
} from './types';

const DEFAULT_BASE_URL = 'https://api.dataforseo.com/v3';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toSearchIntent(raw: unknown): SearchIntent | null {
  return typeof raw === 'string' && (SEARCH_INTENTS as readonly string[]).includes(raw)
    ? (raw as SearchIntent)
    : null;
}

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function nonEmptyString(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
}

function integerArray(raw: unknown): number[] {
  return Array.isArray(raw)
    ? raw.filter(
        (value): value is number =>
          typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value),
      )
    : [];
}

/**
 * Labs site endpoints require `target` as a bare domain ("without https:// and
 * www."), but org/competitor URLs arrive as full URLs — strip scheme, www, and path.
 */
function bareDomain(target: string): string {
  const host = target.includes('://') ? new URL(target).hostname : (target.split('/')[0] as string);
  return host.replace(/^www\./, '');
}

/** Normalize one Labs `items[]` entry into a KeywordMetric. */
function toKeywordMetric(item: Record<string, unknown>): KeywordMetric {
  const info = (item.keyword_info ?? {}) as Record<string, unknown>;
  const props = (item.keyword_properties ?? {}) as Record<string, unknown>;
  const intentInfo = (item.search_intent_info ?? {}) as Record<string, unknown>;
  const trend = (info.search_volume_trend ?? {}) as Record<string, unknown>;
  return {
    keyword: String(item.keyword ?? ''),
    core_keyword: nonEmptyString(props.core_keyword),
    category_ids: integerArray(info.categories),
    search_volume: num(info.search_volume),
    // Difficulty lives in keyword_properties for most Labs endpoints; the bulk
    // endpoint returns it directly on the item.
    difficulty: num(props.keyword_difficulty ?? item.keyword_difficulty),
    cpc: num(info.cpc),
    competition: num(info.competition),
    trend: num(trend.yearly),
    intent: toSearchIntent(intentInfo.main_intent),
  };
}

/**
 * `ranked_keywords` wraps the metrics one level deeper than its siblings — the
 * `keyword_info` / `keyword_properties` objects live under `keyword_data`.
 * Unwrap it before normalizing, or every metric (including the keyword itself)
 * reads as missing.
 */
function toRankedKeywordMetric(item: Record<string, unknown>): KeywordMetric {
  return toKeywordMetric((item.keyword_data ?? item) as Record<string, unknown>);
}

/** Normalize one SERP `items[]` organic entry. */
function toSerpResult(item: Record<string, unknown>): SerpResult {
  return {
    rank: num(item.rank_absolute) ?? 0,
    url: String(item.url ?? ''),
    domain: String(item.domain ?? ''),
    title: String(item.title ?? ''),
  };
}

/**
 * DataForSEO's backlink rank is 0–1000; the dashboard badge shows a 0–100
 * DR-style score (#12). Clamped so provider drift can't break the schema.
 */
export function domainRatingFromRank(rank: number | null): number | null {
  if (rank === null) return null;
  return Math.max(0, Math.min(100, Math.round(rank / 10)));
}

export type DataForSeoClient = {
  keywordsForSite(params: SiteKeywordsParams): Promise<KeywordMetric[]>;
  rankedKeywords(params: SiteKeywordsParams): Promise<KeywordMetric[]>;
  keywordIdeas(params: SeedKeywordsParams): Promise<KeywordMetric[]>;
  keywordSuggestions(params: SuggestionKeywordsParams): Promise<KeywordMetric[]>;
  bulkKeywordDifficulty(params: SeedKeywordsParams): Promise<KeywordMetric[]>;
  serpGoogleOrganic(params: SerpParams): Promise<SerpResult[]>;
  backlinksSummary(target: string): Promise<BacklinksSummary>;
};

export function createDataForSeoClient(config: DataForSeoConfig): DataForSeoClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const authHeader = `Basic ${Buffer.from(`${config.login}:${config.password}`).toString('base64')}`;

  /** POST a single task and return its `result` array. Handles timeout/retry. */
  async function request(path: string, task: Record<string, unknown>): Promise<unknown[]> {
    let attempt = 0;
    // Loop: initial try + up to maxRetries retries on retryable categories.
    for (;;) {
      try {
        return await once(path, task);
      } catch (err) {
        const retryable = err instanceof DataForSeoError && isRetryable(err.category);
        if (!retryable || attempt >= maxRetries) throw err;
        await sleep(retryDelayMs * 2 ** attempt);
        attempt += 1;
      }
    }
  }

  async function once(path: string, task: Record<string, unknown>): Promise<unknown[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify([task]),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new DataForSeoError('timeout', 'DataForSEO request timed out (timeout)');
      }
      throw new DataForSeoError('network', 'DataForSEO request failed (network)');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // DataForSEO mirrors body/task errors in the HTTP status (e.g. 402 for a
      // 40200 "Payment Required." task) — read the body when it's JSON so the
      // error keeps the provider's precise category and status_message; a
      // non-envelope body still surfaces as a snippet.
      const raw = await res.text().catch(() => '');
      let errBody: {
        status_code?: number;
        status_message?: string;
        tasks?: Array<{ status_code?: number; status_message?: string }>;
      } | null = null;
      try {
        errBody = JSON.parse(raw);
      } catch {}
      const src = [errBody?.tasks?.[0], errBody].find(
        (s) => typeof s?.status_code === 'number' && s.status_code >= 30000,
      );
      const category = src?.status_code
        ? categorizeApiStatus(src.status_code)
        : categorizeHttpStatus(res.status);
      const excerpt = src?.status_message ?? bodySnippet(raw);
      const suffix = excerpt ? ` — ${excerpt}` : '';
      throw new DataForSeoError(
        category,
        `DataForSEO request failed (${category}): HTTP ${res.status}${suffix}`,
        { status: res.status },
      );
    }

    const body = (await res.json()) as {
      status_code?: number;
      status_message?: string;
      tasks?: Array<{ status_code?: number; status_message?: string; result?: unknown[] }>;
    };

    // status_message is the provider's own text (never credentials) — keep it so
    // logs name the rejected field instead of a bare category.
    const detail = (msg?: string) => (msg ? `: ${msg}` : '');

    if (typeof body.status_code === 'number' && body.status_code >= 30000) {
      const category = categorizeApiStatus(body.status_code);
      throw new DataForSeoError(
        category,
        `DataForSEO request failed (${category})${detail(body.status_message)}`,
      );
    }

    const taskResult = body.tasks?.[0];
    if (taskResult?.status_code && taskResult.status_code >= 30000) {
      const category = categorizeApiStatus(taskResult.status_code);
      throw new DataForSeoError(
        category,
        `DataForSEO request failed (${category})${detail(taskResult.status_message)}`,
      );
    }

    return taskResult?.result ?? [];
  }

  /** Flatten the `result[].items[]` shape the Labs endpoints share. */
  function itemsOf(result: unknown[]): Record<string, unknown>[] {
    return result.flatMap((r) => {
      const items = (r as { items?: unknown[] }).items ?? [];
      return items as Record<string, unknown>[];
    });
  }

  /** Apply the shared Labs result-shaping params to a task payload. */
  function shape(task: Record<string, unknown>, params: LabsQueryShape): Record<string, unknown> {
    if (params.limit) task.limit = params.limit;
    if (params.orderBy?.length) task.order_by = params.orderBy;
    if (params.filters?.length) task.filters = params.filters;
    return task;
  }

  return {
    async keywordsForSite(params: SiteKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { target: bareDomain(params.target) };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      const result = await request(
        '/dataforseo_labs/google/keywords_for_site/live',
        shape(task, params),
      );
      return itemsOf(result).map(toKeywordMetric);
    },

    async rankedKeywords(params: SiteKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { target: bareDomain(params.target) };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      const result = await request(
        '/dataforseo_labs/google/ranked_keywords/live',
        shape(task, params),
      );
      return itemsOf(result).map(toRankedKeywordMetric);
    },

    async keywordIdeas(params: SeedKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { keywords: params.keywords };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      const result = await request(
        '/dataforseo_labs/google/keyword_ideas/live',
        shape(task, params),
      );
      return itemsOf(result).map(toKeywordMetric);
    },

    /**
     * Long-tail phrases CONTAINING the seed. `keyword_ideas` returns
     * category-adjacent terms instead, which is how a niche B2B pool drifted
     * into consumer topics (#211). One seed per call — fan out at the caller.
     */
    async keywordSuggestions(params: SuggestionKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { keyword: params.keyword };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      const result = await request(
        '/dataforseo_labs/google/keyword_suggestions/live',
        shape(task, params),
      );
      return itemsOf(result).map(toKeywordMetric);
    },

    async bulkKeywordDifficulty(params: SeedKeywordsParams): Promise<KeywordMetric[]> {
      const task: Record<string, unknown> = { keywords: params.keywords };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      const result = await request('/dataforseo_labs/google/bulk_keyword_difficulty/live', task);
      return itemsOf(result).map(toKeywordMetric);
    },

    async serpGoogleOrganic(params: SerpParams): Promise<SerpResult[]> {
      const task: Record<string, unknown> = { keyword: params.keyword };
      if (params.locationName) task.location_name = params.locationName;
      if (params.languageName) task.language_name = params.languageName;
      if (params.depth) task.depth = params.depth;
      const result = await request('/serp/google/organic/live/advanced', task);
      return itemsOf(result)
        .filter((item) => item.type === 'organic')
        .map(toSerpResult);
    },

    async backlinksSummary(target: string): Promise<BacklinksSummary> {
      const result = await request('/backlinks/summary/live', { target });
      const first = (result[0] ?? {}) as Record<string, unknown>;
      return { rank: num(first.rank) };
    },
  };
}
