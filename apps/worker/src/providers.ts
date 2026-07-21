import {
  createDataForSeoClient,
  createFalClient,
  createOpenRouterClient,
  createYouTubeClient,
} from '@shared/providers';

/** Build the DataForSEO + LLM clients the strategy pipeline needs, from env. */
export function getStrategyClients() {
  return {
    dataForSeo: createDataForSeoClient({
      login: process.env.DATAFORSEO_LOGIN ?? '',
      password: process.env.DATAFORSEO_PASSWORD ?? '',
    }),
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
  };
}

/** Build the LLM + YouTube clients the generation worker needs, from env (#55/#85). */
export function getGenerationClients() {
  return {
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
    youtube: createYouTubeClient({ apiKey: process.env.YOUTUBE_API_KEY ?? '' }),
  };
}

/** Build the LLM (plan) + image (fal) clients the images worker needs, from env (#51). */
export function getImageClients() {
  return {
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
    image: createFalClient({ apiKey: process.env.FAL_KEY ?? '' }),
  };
}

/** Build the LLM + DataForSEO clients the scanner worker needs, from env. */
export function getScanClients() {
  return {
    llm: createOpenRouterClient({ apiKey: process.env.OPENROUTER_API_KEY ?? '' }),
    dataForSeo: createDataForSeoClient({
      login: process.env.DATAFORSEO_LOGIN ?? '',
      password: process.env.DATAFORSEO_PASSWORD ?? '',
    }),
  };
}
