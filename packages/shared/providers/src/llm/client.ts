import { isRetryableProviderError, ProviderError, providerHttpError } from '../errors';
import { DEFAULT_LLM_MODEL, DEFAULT_LLM_PROVIDER, DEFAULT_LLM_TIMEOUT_MS } from './routing';
import type { LlmClient, LlmCompleteParams, LlmConfig, LlmResult } from './types';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function num(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

export function createOpenRouterClient(config: LlmConfig): LlmClient {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const defaultModel = config.defaultModel ?? DEFAULT_LLM_MODEL;
  const defaultProvider = config.defaultProvider ?? DEFAULT_LLM_PROVIDER;
  const timeoutMs = config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryDelayMs = config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };
  if (config.appReferer) headers['HTTP-Referer'] = config.appReferer;
  if (config.appTitle) headers['X-Title'] = config.appTitle;

  /** One POST to /chat/completions. Handles timeout + maps failures to ProviderError. */
  async function once(body: Record<string, unknown>, timeout: number): Promise<LlmResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
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

    if (!res.ok) throw await providerHttpError('OpenRouter', res);

    const json = (await res.json()) as {
      model?: string;
      provider?: string;
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
      provider: json.provider ?? null,
      usage: {
        promptTokens: num(usage.prompt_tokens),
        completionTokens: num(usage.completion_tokens),
        totalTokens: num(usage.total_tokens),
        costUsd: typeof usage.cost === 'number' ? usage.cost : null,
      },
    };
  }

  /** `once`, plus retries on transient transport failures. */
  async function send(body: Record<string, unknown>, timeout: number): Promise<LlmResult> {
    let attempt = 0;
    // Loop: initial try + up to maxRetries retries on retryable categories.
    for (;;) {
      try {
        return await once(body, timeout);
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
      if (params.responseSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: params.responseSchema.name,
            strict: true,
            schema: params.responseSchema.schema,
          },
        };
      }
      // Every call is pinned to one provider with fallbacks off: the routing
      // table picks models for their price on a specific host, and OpenRouter
      // would otherwise reroute a busy provider to a pricier host of the same
      // model without a trace. With a schema, require_parameters also refuses
      // an endpoint that would silently DROP response_format and fall back to
      // unconstrained output — the failure structured outputs were added to fix.
      body.provider = {
        only: [params.provider ?? defaultProvider],
        allow_fallbacks: false,
        ...(params.responseSchema ? { require_parameters: true } : {}),
      };

      const timeout = params.timeoutMs ?? timeoutMs;
      const result = await send(body, timeout);
      // An empty body is a 200 OK that says nothing: every caller parses JSON out
      // of `text`, so there is no reading under which "" is an answer. Measured
      // on the previous default (GLM-5.2), a reasoning model that spent its
      // entire 65,536-token output budget on reasoning and emitted no content —
      // once for a classify body, and again on 2 of 15 batched SERP-judge calls
      // (#211). Haiku 4.5 does not reason by default, so this should now be
      // dormant; it stays as a provider-agnostic guard, because the callers'
      // degradation paths (fail-open judge, `other` seed) are silent by design
      // and a second sample is far cheaper than a stage that quietly does
      // nothing. If it repeats, return the empty result and let those paths run
      // unchanged.
      if (result.text.trim().length > 0) return result;
      return send(body, timeout);
    },
  };
}
