import { isRetryableProviderError, ProviderError, providerHttpError } from '../errors';
import type { YouTubeClient, YouTubeConfig, YouTubeSearchOpts, YouTubeVideo } from './types';

const DEFAULT_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;
const DEFAULT_MAX_RESULTS = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * search.list returns snippet text HTML-entity-encoded (`&#39;`, `&amp;`,
 * `&quot;`). Decode it so callers get plain text and escape once themselves.
 */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function createYouTubeClient(config: YouTubeConfig): YouTubeClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  /**
   * One GET to /search. The API key travels in the query string, so error
   * messages never include the URL.
   */
  async function once(params: URLSearchParams): Promise<YouTubeVideo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/search?${params}`, { signal: controller.signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderError('timeout', 'YouTube request timed out (timeout)');
      }
      throw new ProviderError('network', 'YouTube request failed (network)');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) throw await providerHttpError('YouTube', res);

    const json = (await res.json()) as {
      items?: Array<{
        id?: { videoId?: string };
        snippet?: { title?: string; description?: string; channelTitle?: string };
      }>;
    };
    return (json.items ?? [])
      .filter((item) => typeof item.id?.videoId === 'string' && item.id.videoId !== '')
      .map((item) => ({
        video_id: String(item.id?.videoId),
        title: decodeEntities(String(item.snippet?.title ?? '')),
        description: decodeEntities(String(item.snippet?.description ?? '')),
        channel: decodeEntities(String(item.snippet?.channelTitle ?? '')),
      }));
  }

  return {
    async searchVideos(query: string, opts?: YouTubeSearchOpts): Promise<YouTubeVideo[]> {
      const params = new URLSearchParams({
        part: 'snippet',
        type: 'video',
        videoEmbeddable: 'true',
        maxResults: String(opts?.max ?? DEFAULT_MAX_RESULTS),
        q: query,
        key: config.apiKey,
      });
      if (opts?.relevanceLanguage) params.set('relevanceLanguage', opts.relevanceLanguage);

      let attempt = 0;
      // Loop: initial try + up to maxRetries retries on retryable categories.
      for (;;) {
        try {
          return await once(params);
        } catch (err) {
          const retryable = err instanceof ProviderError && isRetryableProviderError(err.category);
          if (!retryable || attempt >= maxRetries) throw err;
          await sleep(retryDelayMs * 2 ** attempt);
          attempt += 1;
        }
      }
    },
  };
}
