import { categorizeProviderHttpStatus, isRetryableProviderError, ProviderError } from '../errors';
import type { LlmClient, LlmCompleteParams, LlmConfig, LlmResult } from './types';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'z-ai/glm-5.2';
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function num(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function createOpenRouterClient(config: LlmConfig): LlmClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const defaultModel = config.defaultModel ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.appReferer) headers['HTTP-Referer'] = config.appReferer;
  if (config.appTitle) headers['X-Title'] = config.appTitle;

  /** One POST to /chat/completions. Handles timeout + maps failures to ProviderError. */
  async function once(body: Record<string, unknown>): Promise<LlmResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new ProviderError('timeout', 'OpenRouter request timed out (timeout)');
      }
      throw new ProviderError('network', 'OpenRouter request failed (network)');
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const category = categorizeProviderHttpStatus(res.status);
      throw new ProviderError(category, `OpenRouter request failed (${category})`);
    }

    const json = (await res.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        cost?: number;
      };
    };
    const usage = json.usage ?? {};
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      model: json.model ?? defaultModel,
      usage: {
        promptTokens: num(usage.prompt_tokens),
        completionTokens: num(usage.completion_tokens),
        totalTokens: num(usage.total_tokens),
        costUsd: typeof usage.cost === 'number' ? usage.cost : null,
      },
    };
  }

  /** `once`, plus retries on transient transport failures. */
  async function send(body: Record<string, unknown>): Promise<LlmResult> {
    let attempt = 0;
    // Loop: initial try + up to maxRetries retries on retryable categories.
    for (;;) {
      try {
        return await once(body);
      } catch (err) {
        const retryable = err instanceof ProviderError && isRetryableProviderError(err.category);
        if (!retryable || attempt >= maxRetries) throw err;
        await sleep(retryDelayMs * 2 ** attempt);
        attempt += 1;
      }
    }
  }

  return {
    async complete(params: LlmCompleteParams): Promise<LlmResult> {
      const body: Record<string, unknown> = {
        model: params.model ?? defaultModel,
        messages: params.messages,
      };
      if (params.maxTokens !== undefined) body.max_tokens = params.maxTokens;
      if (params.temperature !== undefined) body.temperature = params.temperature;
      if (params.responseFormat === 'json') body.response_format = { type: 'json_object' };

      const result = await send(body);
      // An empty body is a 200 OK that says nothing: every caller parses JSON out
      // of `text`, so there is no reading under which "" is an answer. A
      // reasoning model produces it by spending its entire output budget on
      // reasoning tokens and emitting no content — measured on GLM-5.2 at 65,536
      // completion tokens for an empty classify body, and again on 2 of 15
      // batched SERP-judge calls (#211). One retry, because the callers'
      // degradation paths (fail-open judge, `other` seed) are silent by design
      // and a second sample is far cheaper than a stage that quietly does
      // nothing. If it repeats, return the empty result and let those paths run
      // unchanged.
      if (result.text.trim().length > 0) return result;
      return send(body);
    },
  };
}
