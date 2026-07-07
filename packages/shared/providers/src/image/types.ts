/** Neutral aspect/size enum, mapped to the provider's own size param. */
export type ImageSize = 'square' | 'landscape_16_9' | 'landscape_4_3' | 'portrait_16_9';

export interface ImageGenerateParams {
  prompt: string;
  /** Defaults to config.defaultModel. */
  model?: string;
  size?: ImageSize;
  seed?: number;
}

export interface ImageResult {
  images: { url: string; width: number | null; height: number | null }[];
  seed: number | null;
}

export interface ImageConfig {
  apiKey: string;
  /** Defaults to 'fal-ai/flux/dev'. */
  defaultModel?: string;
  /** Defaults to 'https://fal.run'. */
  baseUrl?: string;
  /** Per-request timeout. Default 120000ms (image gen is slow). */
  timeoutMs?: number;
  /** Retries on transient errors. Default 2. */
  maxRetries?: number;
  /** Base backoff between retries (ms), doubled each attempt. Default 500. */
  retryDelayMs?: number;
}

export interface ImageClient {
  generate(params: ImageGenerateParams): Promise<ImageResult>;
}
