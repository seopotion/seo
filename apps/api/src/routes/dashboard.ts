import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import { type AuthEnv, authMiddleware } from '../middlewares/auth';
import * as schemas from '../schemas/dashboard';

/**
 * Dashboard Home routes (design/product-flow.md, Dashboard §1). All require a
 * Bearer JWT — the dashboard is gated behind a completed setup. Responses are
 * mock/empty for now: a fresh org has nothing published or planned, no
 * integrations connected, and performance blocks stay gated until Google
 * Search Console is wired up. Swap the handler bodies for real reads later.
 */
const dashboard = new OpenAPIHono<AuthEnv>()
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/best',
      summary: 'Best-performing articles (gated until Google Search Console is connected)',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.BestArticlesResponse } },
          description: 'Best articles; empty + gated until live Google data is connected',
        },
      },
    }),
    (c) => c.json({ articles: [], gated: true }),
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/published',
      summary: 'Count of published articles',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleCountResponse } },
          description: 'Published article count (0 for a fresh org)',
        },
      },
    }),
    (c) => c.json({ count: 0 }),
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/articles/planned',
      summary: 'Count of planned articles',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ArticleCountResponse } },
          description: 'Planned article count (0 for a fresh org)',
        },
      },
    }),
    (c) => c.json({ count: 0 }),
  )
  .openapi(
    createRoute({
      tags: ['dashboard'],
      method: 'get',
      path: '/integrations/connected',
      summary: 'Connected publishing integrations',
      security: [{ Bearer: [] }],
      middleware: [authMiddleware] as const,
      responses: {
        200: {
          content: { 'application/json': { schema: schemas.ConnectedIntegrationsResponse } },
          description: 'Connected integrations (empty for a fresh org)',
        },
      },
    }),
    (c) => c.json({ integrations: [] }),
  );

export default dashboard;
