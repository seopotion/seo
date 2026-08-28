import {
  createFalClient,
  createOpenRouterClient,
  createYouTubeClient,
  resolveProviderSecret,
} from '@shared/providers';

/** Same runtime-secret pattern as apps/worker/src/providers.ts (SSM param when
 * deployed, plain env var locally; Powertools caches ~1h). */
export async function getArticleStageClients() {
  const [apiKey, youtubeKey, falKey] = await Promise.all([
    resolveProviderSecret('OPENROUTER_API_KEY'),
    resolveProviderSecret('YOUTUBE_API_KEY'),
    resolveProviderSecret('FAL_KEY'),
  ]);
  return {
    llm: createOpenRouterClient({ apiKey }),
    youtube: createYouTubeClient({ apiKey: youtubeKey }),
    image: createFalClient({ apiKey: falKey }),
  };
}
export type ArticleStageClients = Awaited<ReturnType<typeof getArticleStageClients>>;
