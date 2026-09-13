import type { LlmResponseSchema } from '@shared/schemas';

export type LlmRole = 'system' | 'user' | 'assistant';
export interface LlmMessage {
  role: LlmRole;
  content: string;
}

export interface LlmCompleteParams {
  messages: LlmMessage[];
  /** Defaults to config.defaultModel. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Overrides the client's configured timeout for this call (routed per model). */
  timeoutMs?: number;
  /**
   * Constrain the response to a JSON Schema (OpenRouter structured outputs).
   * Omit for free-form text. There is deliberately no plain "JSON mode" option:
   * it guarantees only that the bytes parse, never that a field is present, and
   * a scan once dead-lettered on an `audience.target` the model simply left out.
   */
  responseSchema?: LlmResponseSchema;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** OpenRouter usage.cost (USD) when reported; null otherwise. */
  costUsd: number | null;
}

export interface LlmResult {
  text: string;
  model: string;
  usage: LlmUsage;
}

export interface LlmConfig {
  apiKey: string;
  /** Defaults to 'anthropic/claude-haiku-4.5'. */
  defaultModel?: string;
  /** Defaults to 'https://openrouter.ai/api/v1'. */
  baseUrl?: string;
  /** Per-request timeout. Default 60000ms. */
  timeoutMs?: number;
  /** Retries on transient errors. Default 2. */
  maxRetries?: number;
  /** Base backoff between retries (ms), doubled each attempt. Default 200. */
  retryDelayMs?: number;
  /** Optional OpenRouter attribution (HTTP-Referer). */
  appReferer?: string;
  /** Optional OpenRouter attribution (X-OpenRouter-Title). */
  appTitle?: string;
}

export interface LlmClient {
  complete(params: LlmCompleteParams): Promise<LlmResult>;
}
