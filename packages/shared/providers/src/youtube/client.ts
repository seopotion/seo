import { categorizeProviderHttpStatus, isRetryableProviderError, ProviderError } from '../errors';
import type { YouTubeClient, YouTubeConfig, YouTubeSearchOpts, YouTubeVideo } from './types';

const DEFAULT_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;
const DEFAULT_MAX_RESULTS = 10;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

    if (!res.ok) {
      const category = categorizeProviderHttpStatus(res.status);
      throw new ProviderError(category, `YouTube request failed (${category})`);
    }

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
        title: String(item.snippet?.title ?? ''),
        description: String(item.snippet?.description ?? ''),
        channel: String(item.snippet?.channelTitle ?? ''),
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
