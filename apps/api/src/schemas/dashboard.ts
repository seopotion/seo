import { z } from '@hono/zod-openapi';

/**
 * Dashboard Home schemas. These back the four Home-page endpoints in
 * design/product-flow.md (Dashboard §1). The data is mocked/empty for now —
 * a fresh org has nothing published or planned, and the performance blocks
 * stay gated until Google Search Console is connected.
 */

const BestArticle = z
  .object({
    id: z.string(),
    title: z.string(),
    url: z.string(),
    clicks: z.number().int(),
  })
  .openapi('BestArticle');

export const BestArticlesResponse = z
  .object({
    articles: z.array(BestArticle),
    // Best articles unlock once live Google Search Console data is connected.
    gated: z.boolean(),
  })
  .openapi('BestArticlesResponse');

export const ArticleCountResponse = z
  .object({
    count: z.number().int(),
  })
  .openapi('ArticleCountResponse');

const ConnectedIntegration = z
  .object({
    id: z.string(),
    provider: z.string(),
    connected_at: z.string(),
  })
  .openapi('ConnectedIntegration');

export const ConnectedIntegrationsResponse = z
  .object({
    integrations: z.array(ConnectedIntegration),
  })
  .openapi('ConnectedIntegrationsResponse');
