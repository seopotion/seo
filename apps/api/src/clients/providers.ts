import {
  createDataForSeoClient,
  type DataForSeoClient,
  resolveProviderSecret,
} from '@shared/providers';

/**
 * Mirrors the SSM cache TTL in @shared/providers `resolveProviderSecret`: past
 * it, rebuild so Powertools re-fetches and rotated credentials take effect.
 * Measured from when credentials resolve, matching how Powertools ages its own
 * cache entries — see `getDataForSeoClient`.
 */
const CLIENT_MAX_AGE_MS = 3_600_000;

let client: Promise<DataForSeoClient> | undefined;
let expiresAt = 0;

/**
 * Module-scoped DataForSEO client (warm-reuse across Lambda invocations).
 *
 * The promise — not the client — is cached, so concurrent first calls share one
 * credential resolution. Credentials come from SSM when `DATAFORSEO_*_PARAM` is
 * set, otherwise the plain env vars (see @shared/providers `resolveProviderSecret`).
 */
export function getDataForSeoClient(): Promise<DataForSeoClient> {
  if (client && Date.now() < expiresAt) return client;

  const pending = (async () => {
    const [login, password] = await Promise.all([
      resolveProviderSecret('DATAFORSEO_LOGIN'),
      resolveProviderSecret('DATAFORSEO_PASSWORD'),
    ]);
    return createDataForSeoClient({ login, password });
  })();

  client = pending;
  // Never expire while the lookup is still in flight, so concurrent callers
  // share this one promise. The real window opens below, on resolution.
  expiresAt = Number.POSITIVE_INFINITY;

  // Both handlers check `client === pending` so a slow initialization can't
  // clobber a newer one that has already replaced it.
  pending.then(
    () => {
      // Time the window from when credentials actually landed, not from when we
      // asked: Powertools starts its own TTL on the SSM response. Expiring first
      // would rebuild while its cache is still warm and re-cache the same stale
      // credentials for another hour.
      if (client === pending) expiresAt = Date.now() + CLIENT_MAX_AGE_MS;
    },
    () => {
      // A rejected promise must not stay cached, or one transient SSM failure
      // fails every later call in this warm Lambda.
      if (client === pending) {
        client = undefined;
        expiresAt = 0;
      }
    },
  );

  return pending;
}
