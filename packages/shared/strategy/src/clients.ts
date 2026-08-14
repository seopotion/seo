import {
  createDataForSeoClient,
  createOpenRouterClient,
  resolveProviderSecret,
} from '@shared/providers';

/**
 * Provider credentials resolve at runtime: an SSM SecureString named by
 * `<NAME>_PARAM` when deployed, the plain `<NAME>` env var locally. Powertools
 * caches each value ~1h, so a warm Lambda pays the fetch once — hence the
 * factories being async rather than reading `process.env` inline.
 */

/** Build the DataForSEO + LLM clients the strategy pipeline needs. */
export async function getStrategyClients() {
  const [login, password, apiKey] = await Promise.all([
    resolveProviderSecret('DATAFORSEO_LOGIN'),
    resolveProviderSecret('DATAFORSEO_PASSWORD'),
    resolveProviderSecret('OPENROUTER_API_KEY'),
  ]);
  return {
    dataForSeo: createDataForSeoClient({ login, password }),
    llm: createOpenRouterClient({ apiKey }),
  };
}
