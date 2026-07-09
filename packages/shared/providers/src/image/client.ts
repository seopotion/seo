import { categorizeProviderHttpStatus, isRetryableProviderError, ProviderError } from '../errors';
import type { ImageClient, ImageConfig, ImageGenerateParams, ImageResult } from './types';

const DEFAULT_BASE_URL = 'https://fal.run';
const DEFAULT_MODEL = 'fal-ai/flux/dev';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function numOrNull(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function createFalClient(config: ImageConfig): ImageClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const headers = {
    Authorization: `Key ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  /** One POST to /{model}. Handles timeout + maps failures to ProviderError. */
  async function once(model: string, body: Record<string, unknown>): Promise<ImageResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/${model}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderError('timeout', 'fal.ai request timed out (timeout)');
      }
      throw new ProviderError('network', 'fal.ai request failed (network)');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const category = categorizeProviderHttpStatus(res.status);
      throw new ProviderError(category, `fal.ai request failed (${category})`);
    }

    const json = (await res.json()) as {
      images?: Array<{ url?: string; width?: number; height?: number }>;
      seed?: number;
    };
    return {
      images: (json.images ?? []).map((img) => ({
        url: String(img.url ?? ''),
        width: numOrNull(img.width),
        height: numOrNull(img.height),
      })),
      seed: numOrNull(json.seed),
    };
  }

  return {
    async generate(params: ImageGenerateParams): Promise<ImageResult> {
      const model = params.model ?? defaultModel;
      const body: Record<string, unknown> = { prompt: params.prompt };
      if (params.size) body.image_size = params.size;
      if (params.seed !== undefined) body.seed = params.seed;

      let attempt = 0;
      // Loop: initial try + up to maxRetries retries on retryable categories.
      for (;;) {
        try {
          return await once(model, body);
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
