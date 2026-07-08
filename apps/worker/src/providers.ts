import { createDataForSeoClient, createOpenRouterClient } from '@shared/providers';

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
