import {
  createDataForSeoClient,
  createFalClient,
  createOpenRouterClient,
  createYouTubeClient,
  resolveProviderSecret,
} from '@shared/providers';

/**
 * Provider credentials resolve at runtime: an SSM SecureString named by
 * `<NAME>_PARAM` when deployed, the plain `<NAME>` env var locally. Powertools
 * caches each value ~1h, so a warm Lambda pays the fetch once — hence the
 * factories being async rather than reading `process.env` inline.
 */

/** Build the LLM + YouTube clients the generation worker needs (#55/#85). */
export async function getGenerationClients() {
  const [apiKey, youtubeKey] = await Promise.all([
    resolveProviderSecret('OPENROUTER_API_KEY'),
    resolveProviderSecret('YOUTUBE_API_KEY'),
  ]);
  return {
    llm: createOpenRouterClient({ apiKey }),
    youtube: createYouTubeClient({ apiKey: youtubeKey }),
  };
}

/** Build the LLM (plan) + image (fal) clients the images worker needs (#51). */
export async function getImageClients() {
  const [apiKey, falKey] = await Promise.all([
    resolveProviderSecret('OPENROUTER_API_KEY'),
    resolveProviderSecret('FAL_KEY'),
  ]);
  return {
    llm: createOpenRouterClient({ apiKey }),
    image: createFalClient({ apiKey: falKey }),
  };
}

/** Build the LLM + DataForSEO clients the scanner worker needs. */
export async function getScanClients() {
  const [login, password, apiKey] = await Promise.all([
    resolveProviderSecret('DATAFORSEO_LOGIN'),
    resolveProviderSecret('DATAFORSEO_PASSWORD'),
    resolveProviderSecret('OPENROUTER_API_KEY'),
  ]);
  return {
    llm: createOpenRouterClient({ apiKey }),
    dataForSeo: createDataForSeoClient({ login, password }),
  };
}
