import {
  createDataForSeoClient,
  type DataForSeoClient,
  resolveProviderSecret,
} from '@shared/providers';

let client: Promise<DataForSeoClient> | undefined;

/**
 * Module-scoped DataForSEO client (warm-reuse across Lambda invocations).
 *
 * The promise — not the client — is cached, so concurrent first calls share one
 * credential resolution. Credentials come from SSM when `DATAFORSEO_*_PARAM` is
 * set, otherwise the plain env vars (see @shared/providers `resolveProviderSecret`).
 */
export function getDataForSeoClient(): Promise<DataForSeoClient> {
  if (!client) {
    client = (async () => {
      const [login, password] = await Promise.all([
        resolveProviderSecret('DATAFORSEO_LOGIN'),
        resolveProviderSecret('DATAFORSEO_PASSWORD'),
      ]);
      return createDataForSeoClient({ login, password });
    })();
  }
  return client;
}
