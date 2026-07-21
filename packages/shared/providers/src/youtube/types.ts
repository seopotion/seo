export interface YouTubeConfig {
  apiKey: string;
  /** Defaults to 'https://www.googleapis.com/youtube/v3'. */
  baseUrl?: string;
  /** Per-request timeout. Default 15000ms. */
  timeoutMs?: number;
  /** Retries on transient errors. Default 2. */
  maxRetries?: number;
  /** Base backoff between retries (ms), doubled each attempt. Default 200. */
  retryDelayMs?: number;
}

export interface YouTubeSearchOpts {
  /** Max results (YouTube caps at 50). Default 10. */
  max?: number;
  /** ISO 639-1 code for search.list relevanceLanguage; omitted when undefined. */
  relevanceLanguage?: string;
}

/** Normalized search.list video result. */
export interface YouTubeVideo {
  video_id: string;
  title: string;
  description: string;
  channel: string;
}

export interface YouTubeClient {
  searchVideos(query: string, opts?: YouTubeSearchOpts): Promise<YouTubeVideo[]>;
}
