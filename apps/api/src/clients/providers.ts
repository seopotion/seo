import { createDataForSeoClient, type DataForSeoClient } from '@shared/providers';

let client: DataForSeoClient | undefined;

/** Module-scoped DataForSEO client (warm-reuse across Lambda invocations). */
export function getDataForSeoClient(): DataForSeoClient {
  if (!client) {
    client = createDataForSeoClient({
      login: process.env.DATAFORSEO_LOGIN ?? '',
      password: process.env.DATAFORSEO_PASSWORD ?? '',
    });
  }
  return client;
}
