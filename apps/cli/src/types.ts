/**
 * Core types for the seo CLI.
 *
 * Every lib function returns Result<T>. Errors are structured and
 * machine-readable. Commands translate Results into output + exit codes.
 */

export interface CliError {
  code: string;
  message: string;
  suggestion?: string;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: CliError };

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: string, message: string, suggestion?: string): Result<never> => ({
  ok: false,
  error: { code, message, suggestion },
});

export const EXIT = {
  SUCCESS: 0,
  USER_ERROR: 1,
  INFRA_DOWN: 2,
  OP_FAILED: 3,
  INTERNAL: 4,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type OutputMode = 'text' | 'json';

export interface Emitter {
  step(name: string, status: 'start' | 'done' | 'fail', detail?: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  result<T>(data: Result<T>): void;
}

export type InfraService = 'mongo' | 'sqs' | 'api';

export interface ServiceCheck {
  service: InfraService;
  available: boolean;
  latencyMs?: number;
  error?: string;
}

export interface InfraCheckResult {
  allHealthy: boolean;
  services: ServiceCheck[];
}

export interface DbInitData {
  collections: string[];
}

export interface SetPlanData {
  org_id: string;
  plan: string;
  /** True when escalating to paid kicked off the 30-day strategy pipeline. */
  strategy_enqueued: boolean;
}

export interface ResetUserData {
  user_id: string;
  org_ids: string[];
  /** Active provider (LemonSqueezy) subscriptions cancelled before deletion. */
  cancelled_subscriptions: number;
  deleted: {
    orgs: number;
    keywords: number;
    candidates: number;
    articles: number;
    gsc_connections: number;
    subscriptions: number;
  };
}

export interface DeleteUserData extends ResetUserData {
  user_deleted: boolean;
}

export type Stage = 'staging' | 'prod';

export interface PrereqCheck {
  name: string; // SSM parameter name or env var name
  kind: 'ssm' | 'env';
  present: boolean;
  error?: string;
}

export interface PreflightResult {
  stage: Stage;
  ready: boolean;
  checks: PrereqCheck[];
}

/** `db clean-links` report (#186). `publishedChanged` are live articles whose
 * content changed — republish them so the fix reaches the customer's site. */
export interface CleanLinksData {
  org: string;
  apply: boolean;
  scanned: number;
  changed: number;
  linksRemoved: number;
  publishedChanged: { id: string; title: string }[];
}
