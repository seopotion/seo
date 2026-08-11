/**
 * Provider record/replay for `db strategy-dryrun` (#211).
 *
 * Every fix we're making to scoring and selection is downstream of gather, so a
 * recorded run makes the iteration loop free: `--snapshot` wraps the real
 * clients and captures each response, `--replay` serves them back with no
 * network at all. A replay miss THROWS rather than returning empty — a missing
 * call is the signal that a code change altered the provider call pattern and
 * the snapshot has to be recaptured, which a silent `[]` would hide as a
 * mysteriously smaller candidate pool. `--allow-live-misses` opts out of the
 * throw and fetches just the missing calls, growing the snapshot in place.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type { ResolvedConfig } from '@shared/keywords';
import type { DataForSeoClient, LlmClient, LlmMessage, LlmResult } from '@shared/providers';

export const SNAPSHOT_VERSION = 1;

/** Every method of DataForSeoClient, so the wrappers cover the whole interface. */
const DFS_METHODS = [
  'keywordsForSite',
  'rankedKeywords',
  'keywordIdeas',
  'bulkKeywordDifficulty',
  'serpGoogleOrganic',
  'backlinksSummary',
] as const;
type DfsMethod = (typeof DFS_METHODS)[number];

export interface RecordedDfsCall {
  method: DfsMethod;
  key: string;
  params: unknown;
  response: unknown;
}

export interface RecordedLlmCall {
  key: string;
  messages: LlmMessage[];
  response: LlmResult;
}

export interface StrategySnapshot {
  version: number;
  recorded_at: string;
  org_id: string;
  website_url: string;
  /** The config the recorded run resolved — replay warns when it has drifted. */
  config: ResolvedConfig;
  dataforseo: RecordedDfsCall[];
  llm: RecordedLlmCall[];
}

export interface ProviderClients {
  dataForSeo: DataForSeoClient;
  llm: LlmClient;
}

/** JSON with object keys sorted, so a call key doesn't depend on property order. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

const dfsKey = (method: DfsMethod, params: unknown): string => `${method}:${stable(params)}`;

const llmKey = (messages: LlmMessage[]): string =>
  createHash('sha1').update(stable(messages)).digest('hex').slice(0, 12);

const clip = (s: string, n = 160): string =>
  s.length <= n ? s : `${s.slice(0, n).replace(/\s+$/, '')}…`;

type AnyDfs = Record<DfsMethod, (params: never) => Promise<unknown>>;

/**
 * Wrap live clients so every response is captured. Returns the wrapped clients
 * plus a `recorded()` snapshot of what has been seen so far; duplicate calls
 * collapse to one entry since the response is keyed by its exact arguments.
 */
export function createRecordingClients(base: ProviderClients): {
  clients: ProviderClients;
  recorded: () => { dataforseo: RecordedDfsCall[]; llm: RecordedLlmCall[] };
} {
  const dfsCalls = new Map<string, RecordedDfsCall>();
  const llmCalls = new Map<string, RecordedLlmCall>();
  const source = base.dataForSeo as unknown as AnyDfs;

  const dataForSeo = {} as AnyDfs;
  for (const method of DFS_METHODS) {
    dataForSeo[method] = async (params: never) => {
      const response = await source[method](params);
      dfsCalls.set(dfsKey(method, params), {
        method,
        key: dfsKey(method, params),
        params,
        response,
      });
      return response;
    };
  }

  const llm: LlmClient = {
    complete: async (params) => {
      const response = await base.llm.complete(params);
      llmCalls.set(llmKey(params.messages), {
        key: llmKey(params.messages),
        messages: params.messages,
        response,
      });
      return response;
    },
  };

  return {
    clients: { dataForSeo: dataForSeo as unknown as DataForSeoClient, llm },
    recorded: () => ({ dataforseo: [...dfsCalls.values()], llm: [...llmCalls.values()] }),
  };
}

export interface ReplaySession {
  clients: ProviderClients;
  /** Calls the snapshot could not answer, served live instead (0 without `live`). */
  misses: () => { dataforseo: number; llm: number };
  /** The snapshot's calls plus everything the miss path fetched. */
  merged: () => { dataforseo: RecordedDfsCall[]; llm: RecordedLlmCall[] };
}

/**
 * Clients that answer from the snapshot. Without `live` a miss throws, which is
 * the right default: it says the provider call pattern changed. With `live`
 * (the `--allow-live-misses` top-up) a miss falls through to the real provider
 * and is folded into `merged()`, so a change that alters *which* keywords reach
 * SERP validation costs only the new calls instead of a full re-record (#211).
 */
export function createReplayClients(
  snapshot: StrategySnapshot,
  live?: ProviderClients,
): ReplaySession {
  const dfsByKey = new Map(snapshot.dataforseo.map((c) => [c.key, c]));
  const llmByKey = new Map(snapshot.llm.map((c) => [c.key, c]));
  const misses = { dataforseo: 0, llm: 0 };
  const liveDfs = live?.dataForSeo as unknown as AnyDfs | undefined;

  const dataForSeo = {} as AnyDfs;
  for (const method of DFS_METHODS) {
    dataForSeo[method] = async (params: never) => {
      const key = dfsKey(method, params);
      const hit = dfsByKey.get(key);
      if (hit) return hit.response;
      if (liveDfs) {
        const response = await liveDfs[method](params);
        dfsByKey.set(key, { method, key, params, response });
        misses.dataforseo++;
        return response;
      }
      const recorded = snapshot.dataforseo.filter((c) => c.method === method);
      throw new Error(
        [
          `Snapshot has no recorded DataForSEO ${method} call for ${clip(stable(params), 300)}.`,
          `  recorded ${method} calls: ${recorded.length}${
            recorded.length ? ` (e.g. ${clip(stable(recorded[0]?.params), 200)})` : ''
          }`,
          '  The pipeline asked for a call the snapshot does not contain — the provider call pattern changed. Re-record with --snapshot <path>, or top the snapshot up with --allow-live-misses.',
        ].join('\n'),
      );
    };
  }

  const llm: LlmClient = {
    complete: async (params) => {
      const key = llmKey(params.messages);
      const hit = llmByKey.get(key);
      if (hit) return hit.response;
      if (live) {
        const response = await live.llm.complete(params);
        llmByKey.set(key, { key, messages: params.messages, response });
        misses.llm++;
        return response;
      }
      const roleLine = (role: string) => {
        const msg = params.messages.find((m) => m.role === role);
        return `  ${role}: ${msg ? clip(msg.content) : '(none)'}`;
      };
      throw new Error(
        [
          `Snapshot has no recorded LLM response for this call (key ${key}).`,
          roleLine('system'),
          roleLine('user'),
          `  recorded LLM calls: ${snapshot.llm.length}`,
          '  The pipeline asked for a call the snapshot does not contain — the prompt or the call pattern changed. Re-record with --snapshot <path>, or top the snapshot up with --allow-live-misses.',
        ].join('\n'),
      );
    },
  };

  return {
    clients: { dataForSeo: dataForSeo as unknown as DataForSeoClient, llm },
    misses: () => ({ ...misses }),
    merged: () => ({ dataforseo: [...dfsByKey.values()], llm: [...llmByKey.values()] }),
  };
}

export async function writeSnapshot(path: string, snapshot: StrategySnapshot): Promise<void> {
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

export async function readSnapshot(path: string): Promise<StrategySnapshot> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<StrategySnapshot>;
  if (parsed.version !== SNAPSHOT_VERSION) {
    throw new Error(
      `Snapshot ${path} has version ${String(parsed.version)}, expected ${SNAPSHOT_VERSION}. Re-record it with --snapshot.`,
    );
  }
  if (!Array.isArray(parsed.dataforseo) || !Array.isArray(parsed.llm) || !parsed.config) {
    throw new Error(`Snapshot ${path} is malformed (missing config/dataforseo/llm).`);
  }
  return parsed as StrategySnapshot;
}

/**
 * Config keys whose recorded value differs from the current run's. Any drift is
 * worth surfacing: it changes what the pipeline asks for, so a replay can be
 * both green and no longer representative.
 */
export function configDrift(recorded: ResolvedConfig, current: ResolvedConfig): string[] {
  const keys = [
    ...new Set([...Object.keys(recorded), ...Object.keys(current)]),
  ] as (keyof ResolvedConfig)[];
  return keys
    .filter((k) => stable(recorded[k]) !== stable(current[k]))
    .map((k) => `${String(k)}: recorded ${stable(recorded[k])} → now ${stable(current[k])}`);
}
